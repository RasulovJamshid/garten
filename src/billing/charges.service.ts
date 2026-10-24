import { allocateCredit } from '../payments/allocate-credit';
import { CreateAdjustmentDto } from './dto/adjustment.dto';
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
    const where: Record<string, unknown> = {
      sign: 1,
      child: this.tenantPrisma.childWhere('charge:read'),
      otherCharge: { none: { sign: -1 } },
    };
    if (filters.childId) where.childId = filters.childId;
    if (filters.periodId) where.periodId = filters.periodId;
    if (filters.kind) where.kind = filters.kind;

    const charges = await this.tenantPrisma.db.charge.findMany({
      where,
      include: {
        accountingPeriod: { select: { year: true, month: true } },
        child: { select: { id: true, firstName: true, lastName: true } },
        paymentAllocation: {
          include: { payment: { select: { otherPayment: { select: { id: true } } } } },
        },
      },
      orderBy: { issuedAt: 'desc' },
    });

    const outstandingRows = await this.tenantPrisma.db.$queryRaw<
      { id: string; outstanding_tiyin: unknown }[]
    >`SELECT charge_id AS id, outstanding_tiyin FROM v_charge_outstanding WHERE tenant_id = ${this.tenantPrisma.tenantId}::uuid`;
    const balances = new Map(
      outstandingRows.map((r) => [r.id, BigInt(String(r.outstanding_tiyin))]),
    );
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
      return { ...c, allocatedTiyin: allocated, outstandingTiyin: balances.get(c.id) ?? 0n };
    });

    return filters.unpaidOnly
      ? withOutstanding.filter((c) => c.outstandingTiyin > 0n)
      : withOutstanding;
  }

  async adjustment(ctx: AuthContext, dto: CreateAdjustmentDto) {
    const child = await this.tenantPrisma.assertChild(dto.childId, 'charge:generate');
    if (dto.reason.trim().length < 10)
      throw AppErrors.validationFailed('Adjustment requires a reason of at least 10 characters');
    if (BigInt(dto.amountTiyin) <= 0n)
      throw AppErrors.validationFailed('Adjustment amount must be positive');
    return this.tenantPrisma.db.$transaction(async (tx) => {
      const period = await tx.accountingPeriod.findUnique({ where: { id: dto.periodId } });
      if (!period) throw AppErrors.notFound('Period not found');
      if (period.status === 'closed') throw AppErrors.periodClosed();
      const result = await tx.charge.create({
        data: {
          tenantId: ctx.tenantId,
          branchId: child.branchId,
          childId: child.id,
          periodId: period.id,
          kind: 'adjustment',
          sign: dto.sign,
          amountTiyin: BigInt(dto.amountTiyin),
          description: dto.reason,
          dueDate: dto.dueDate ? new Date(dto.dueDate) : null,
          createdBy: ctx.userId,
        },
      });
      await allocateCredit(tx, ctx.tenantId, child.id);
      await this.audit.log(
        {
          userId: ctx.userId,
          action: 'charge.adjustment',
          entityType: 'charge',
          entityId: result.id,
          newValue: { sign: dto.sign, amountTiyin: dto.amountTiyin, reason: dto.reason },
        },
        tx,
      );
      return result;
    });
  }

  async ledger(childId: string) {
    await this.tenantPrisma.assertChild(childId, 'charge:read');
    return this.tenantPrisma.db.charge.findMany({
      where: { childId },
      orderBy: [{ issuedAt: 'asc' }, { id: 'asc' }],
    });
  }

  async forChild(childId: string) {
    return this.list({ childId });
  }

  /**
   * A manual, one-off charge: sign=1, kind='manual'. Signed corrections
   * use createAdjustment; cancellation of an existing charge uses reverse.
   */
  async createManual(ctx: AuthContext, dto: CreateManualChargeDto) {
    const child = await this.tenantPrisma.assertChild(dto.childId, 'charge:generate');
    if (BigInt(dto.amountTiyin) <= 0n)
      throw AppErrors.validationFailed('Charge amount must be positive');

    const period = await this.tenantPrisma.db.accountingPeriod.findUnique({
      where: { id: dto.periodId },
    });
    if (!period) throw AppErrors.notFound('PERIOD_NOT_FOUND');
    if (period.status === 'closed') throw AppErrors.periodClosed();

    const charge = await this.tenantPrisma.db.$transaction(async (tx) => {
      const created = await tx.charge.create({
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

      await allocateCredit(tx, ctx.tenantId, child.id);
      await this.audit.log(
        {
          userId: ctx.userId,
          action: 'charge.create',
          entityType: 'charge',
          entityId: created.id,
          newValue: {
            childId: dto.childId,
            amountTiyin: dto.amountTiyin,
            description: dto.description,
          },
        },
        tx,
      );
      return created;
    });

    return charge;
  }

  /** Never UPDATE, never DELETE — a reversal is a new sign=-1 row (03-billing-rules.md §3.4). */
  async reverse(ctx: AuthContext, id: string, reason: string) {
    if (!reason.trim()) throw AppErrors.validationFailed('Reversal reason is required');
    const lookup = await this.tenantPrisma.db.charge.findUnique({ where: { id } });
    if (!lookup) throw AppErrors.notFound('Charge not found');
    await this.tenantPrisma.assertChild(lookup.childId, 'charge:reverse');
    return this.tenantPrisma.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM child WHERE id = ${lookup.childId}::uuid AND tenant_id = ${ctx.tenantId}::uuid FOR UPDATE`;
      const original = await tx.charge.findUnique({ where: { id } });
      if (!original) throw AppErrors.notFound('Charge not found');
      if (original.sign === -1) throw AppErrors.validationFailed('Cannot reverse a reversal row');

      const existingReversal = await tx.charge.findFirst({
        where: { sourceChargeId: id },
      });
      if (existingReversal) throw AppErrors.conflict('ALREADY_REVERSED');

      const period = await tx.accountingPeriod.findUnique({
        where: { id: original.periodId },
      });
      if (period?.status === 'closed') throw AppErrors.periodClosed();

      const reversal = await tx.charge.create({
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
          adjustmentForChargeId: original.adjustmentForChargeId,
          description: `Reversal of ${id}: ${reason}`,
          reversalReason: reason,
          createdBy: ctx.userId,
        },
      });

      await this.audit.log(
        {
          userId: ctx.userId,
          action: 'charge.reverse',
          entityType: 'charge',
          entityId: id,
          oldValue: { amountTiyin: original.amountTiyin.toString() },
          newValue: { reversalId: reversal.id, reason },
        },
        tx,
      );

      await allocateCredit(tx, ctx.tenantId, original.childId);
      return reversal;
    });
  }
}
