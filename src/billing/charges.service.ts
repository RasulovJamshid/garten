import { Injectable } from '@nestjs/common';
import { TenantPrisma } from '../prisma/tenant-prisma.provider';
import { AuditService } from '../audit/audit.service';
import { AppErrors } from '../common/exceptions/app.exception';
import { AuthContext } from '../common/auth-context';
import { CreateManualChargeDto } from './dto/manual-charge.dto';

@Injectable()
export class ChargesService {
  constructor(
    private readonly tenantPrisma: TenantPrisma,
    private readonly audit: AuditService,
  ) {}

  async list(filters: {
    childId?: string;
    periodId?: string;
    kind?: string;
    unpaidOnly?: boolean;
  }) {
    const where: Record<string, unknown> = { sign: 1 };
    if (filters.childId) where.childId = filters.childId;
    if (filters.periodId) where.periodId = filters.periodId;
    if (filters.kind) where.kind = filters.kind;

    const charges = await this.tenantPrisma.db.charge.findMany({
      where,
      include: {
        paymentAllocation: {
          include: { payment: { select: { otherPayment: { select: { id: true } } } } },
        },
      },
      orderBy: { issuedAt: 'desc' },
      take: 500,
    });

    const withOutstanding = charges.map((c) => {
      // A funding payment's own `sign` is always +1 — cancelling it
      // creates a SEPARATE reversal payment, it doesn't flip the
      // original's sign. So an allocation only still counts if no
      // payment exists whose source_payment_id points back at it
      // (payments.service.ts makes the same correction for allocation).
      const allocated = c.paymentAllocation.reduce(
        (acc, a) => (a.payment.otherPayment.length > 0 ? acc : acc + a.amountTiyin),
        0n,
      );
      return { ...c, allocatedTiyin: allocated, outstandingTiyin: c.amountTiyin - allocated };
    });

    return filters.unpaidOnly
      ? withOutstanding.filter((c) => c.outstandingTiyin > 0n)
      : withOutstanding;
  }

  async forChild(childId: string) {
    return this.list({ childId });
  }

  /**
   * A manual, one-off charge — always sign=1, kind='manual'. Negative
   * adjustments happen through a discount or through reversing an
   * existing charge, never through this endpoint (the DB's own check
   * constraint requires sign=-1 rows to reference a source_charge_id).
   */
  async createManual(ctx: AuthContext, dto: CreateManualChargeDto) {
    const child = await this.tenantPrisma.db.child.findUnique({ where: { id: dto.childId } });
    if (!child) throw AppErrors.notFound('Child not found');

    const period = await this.tenantPrisma.db.accountingPeriod.findUnique({
      where: { id: dto.periodId },
    });
    if (!period) throw AppErrors.notFound('PERIOD_NOT_FOUND');
    if (period.status === 'closed') throw AppErrors.periodClosed();

    const charge = await this.tenantPrisma.db.charge.create({
      data: {
        tenantId: this.tenantPrisma.tenantId,
        branchId: child.branchId,
        childId: dto.childId,
        periodId: dto.periodId,
        kind: 'manual',
        amountTiyin: BigInt(dto.amountTiyin),
        sign: 1,
        description: dto.description,
        createdBy: ctx.userId,
      },
    });

    await this.audit.log({
      userId: ctx.userId,
      action: 'charge.create',
      entityType: 'charge',
      entityId: charge.id,
      newValue: {
        childId: dto.childId,
        amountTiyin: dto.amountTiyin,
        description: dto.description,
      },
    });

    return charge;
  }

  /** Never UPDATE, never DELETE — a reversal is a new sign=-1 row (03-billing-rules.md §3.4). */
  async reverse(ctx: AuthContext, id: string, reason: string) {
    const original = await this.tenantPrisma.db.charge.findUnique({ where: { id } });
    if (!original) throw AppErrors.notFound('Charge not found');
    if (original.sign === -1) throw AppErrors.validationFailed('Cannot reverse a reversal row');

    const existingReversal = await this.tenantPrisma.db.charge.findFirst({
      where: { sourceChargeId: id },
    });
    if (existingReversal) throw AppErrors.conflict('ALREADY_REVERSED');

    const period = await this.tenantPrisma.db.accountingPeriod.findUnique({
      where: { id: original.periodId },
    });
    if (period?.status === 'closed') throw AppErrors.periodClosed();

    const reversal = await this.tenantPrisma.db.charge.create({
      data: {
        tenantId: this.tenantPrisma.tenantId,
        branchId: original.branchId,
        childId: original.childId,
        periodId: original.periodId,
        billingRunId: original.billingRunId,
        billingRulesId: original.billingRulesId,
        kind: original.kind,
        amountTiyin: original.amountTiyin,
        sign: -1,
        sourceChargeId: id,
        description: `Reversal of ${id}: ${reason}`,
        reversalReason: reason,
        createdBy: ctx.userId,
      },
    });

    await this.audit.log({
      userId: ctx.userId,
      action: 'charge.reverse',
      entityType: 'charge',
      entityId: id,
      oldValue: { amountTiyin: original.amountTiyin.toString() },
      newValue: { reversalId: reversal.id, reason },
    });

    return reversal;
  }
}
