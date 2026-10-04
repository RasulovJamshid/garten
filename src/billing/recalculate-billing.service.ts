import { Injectable } from '@nestjs/common';
import { BillingRunsService } from './billing-runs.service';
import { TenantPrisma } from '../prisma/tenant-prisma.provider';
import { AuditService } from '../audit/audit.service';
import { AuthContext } from '../common/auth-context';
import { AppErrors } from '../common/exceptions/app.exception';
import { validateBillingRules } from './validate-billing-rules';
import { allocateCredit } from '../payments/allocate-credit';

@Injectable()
export class RecalculateBillingService {
  constructor(
    private readonly tenant: TenantPrisma,
    private readonly runs: BillingRunsService,
    private readonly audit: AuditService,
  ) {}

  async recalculate(ctx: AuthContext, childId: string, date: Date, tx: any, force = false) {
    await tx.$queryRaw`SELECT id FROM child WHERE id = ${childId}::uuid AND tenant_id = ${ctx.tenantId}::uuid FOR UPDATE`;
    const period = await tx.accountingPeriod.findFirst({
      where: { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1 },
    });
    if (!period) return { status: 'not_required', chargeIds: [] as string[] };
    const charges = await tx.charge.findMany({
      where: {
        childId,
        periodId: period.id,
        sign: 1,
        billingRulesId: { not: null },
        kind: { not: 'adjustment' },
        otherCharge: { none: { sign: -1 } },
      },
      include: { billingRules: true },
    });
    const chargeIds: string[] = [];
    let manual = false;
    for (const original of charges) {
      const rules = validateBillingRules(original.billingRules.rules);
      const policy =
        period.status === 'closed'
          ? rules.recalculation.closedPeriodPolicy
          : rules.recalculation.onAttendanceCorrection;
      if (policy === 'manual_only' && !force) {
        manual = true;
        continue;
      }
      const snapshot = original.tariffSnapshot;
      const segments =
        snapshot?.segments ?? (snapshot?.amountTiyin !== undefined ? [snapshot] : []);
      if (!segments.length)
        throw AppErrors.conflict(
          'MISSING_TARIFF_SNAPSHOT: this charge requires a manual adjustment',
        );
      const assignments = segments.map((s: any) => ({
        billingContext: s.billingContext,
        tariffId: s.id,
        effectiveFrom: new Date(s.effectiveFrom ?? Date.UTC(period.year, period.month - 1, 1)),
        effectiveTo: s.effectiveTo ? new Date(s.effectiveTo) : null,
        tariff: { ...s, kind: original.kind, amountTiyin: BigInt(s.amountTiyin) },
      }));
      const [line] = await this.runs.computeAllLines(
        period.year,
        period.month,
        rules,
        tx,
        childId,
        assignments,
        snapshot.context,
      );
      const previousAdjustments = await tx.charge.findMany({
        where: { adjustmentForChargeId: original.id },
      });
      const effectiveAmount = previousAdjustments.reduce(
        (sum: bigint, c: any) => sum + c.amountTiyin * BigInt(c.sign),
        original.amountTiyin,
      );
      const amount = BigInt(line.amountTiyin);
      if (amount === effectiveAmount) continue;
      if (
        period.status === 'open' &&
        policy !== 'adjust_next_period' &&
        previousAdjustments.length === 0
      ) {
        await tx.charge.create({
          data: {
            tenantId: ctx.tenantId,
            branchId: original.branchId,
            childId,
            periodId: period.id,
            kind: original.kind,
            sign: -1,
            amountTiyin: original.amountTiyin,
            sourceChargeId: original.id,
            reversalReason: 'Attendance correction',
            createdBy: ctx.userId,
          },
        });
        const replacement = await tx.charge.create({
          data: {
            tenantId: ctx.tenantId,
            branchId: original.branchId,
            childId,
            periodId: period.id,
            billingRunId: original.billingRunId,
            billingRulesId: original.billingRulesId,
            kind: original.kind,
            sign: 1,
            amountTiyin: amount,
            tariffSnapshot: original.tariffSnapshot,
            calculationTrace: line.trace,
            dueDate: original.dueDate,
            description: `Replacement for ${original.id}`,
            createdBy: ctx.userId,
          },
        });
        chargeIds.push(replacement.id);
      } else {
        const nextPeriod = await this.nextOpenPeriod(tx, ctx.tenantId, period.year, period.month);
        const delta = amount - effectiveAmount;
        const adjustment = await tx.charge.create({
          data: {
            tenantId: ctx.tenantId,
            branchId: original.branchId,
            childId,
            periodId: nextPeriod.id,
            kind: 'adjustment',
            dueDate: new Date(Date.UTC(nextPeriod.year, nextPeriod.month, 5)),
            sign: delta < 0n ? -1 : 1,
            amountTiyin: delta < 0n ? -delta : delta,
            adjustmentForChargeId: original.id,
            calculationTrace: line.trace,
            description: `Attendance correction for ${period.year}-${period.month}: ${original.id}`,
            createdBy: ctx.userId,
          },
        });
        chargeIds.push(adjustment.id);
      }
    }
    if (chargeIds.length) {
      await allocateCredit(tx, ctx.tenantId, childId);
      await this.audit.log(
        {
          userId: ctx.userId,
          action: 'billing.recalculate',
          entityType: 'child',
          entityId: childId,
          newValue: { periodId: period.id, chargeIds },
        },
        tx,
      );
    }
    return {
      status: manual ? 'manual_required' : chargeIds.length ? 'applied' : 'not_required',
      chargeIds,
    };
  }

  private async nextOpenPeriod(tx: any, tenantId: string, year: number, month: number) {
    for (let i = 0; i < 1200; i++) {
      month++;
      if (month > 12) {
        year++;
        month = 1;
      }
      const period = await tx.accountingPeriod.upsert({
        where: { tenantId_year_month: { tenantId, year, month } },
        create: { tenantId, year, month },
        update: {},
      });
      if (period.status === 'open') return period;
    }
    throw AppErrors.conflict('NO_OPEN_PERIOD');
  }

  async resolve(ctx: AuthContext, childId: string, year: number, month: number) {
    await this.tenant.assertChild(childId, 'charge:generate');
    if (
      !Number.isInteger(year) ||
      !Number.isInteger(month) ||
      month < 1 ||
      month > 12 ||
      year < 2000
    )
      throw AppErrors.validationFailed('Invalid billing period');
    return this.tenant.db.$transaction(
      async (tx) => {
        const result = await this.recalculate(
          ctx,
          childId,
          new Date(Date.UTC(year, month - 1, 1)),
          tx,
          true,
        );
        await tx.attendanceCorrection.updateMany({
          where: {
            billingResolution: 'manual_required',
            attendanceDay: {
              childId,
              attendanceDate: {
                gte: new Date(Date.UTC(year, month - 1, 1)),
                lt: new Date(Date.UTC(year, month, 1)),
              },
            },
          },
          data: { billingResolution: 'applied' },
        });
        return result;
      },
      { timeout: 60000 },
    );
  }
}
