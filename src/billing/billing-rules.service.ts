import { Injectable } from '@nestjs/common';
import { TenantPrisma } from '../prisma/tenant-prisma.provider';
import { AuditService } from '../audit/audit.service';
import { AppErrors } from '../common/exceptions/app.exception';
import { AuthContext } from '../common/auth-context';
import { BillingRules } from './billing-rules.types';
import { DEFAULT_BILLING_RULES } from './default-billing-rules';
import { calculateCharge } from './calculate-charge';
import { resolveBillableDays, billableDaysInWindow } from './billable-days';
import { validateBillingRules } from './validate-billing-rules';
import { enrollmentWindows, EnrollmentWindow } from './enrollment-windows';
import { TariffsService } from '../money/tariffs.service';
import { DiscountsService } from '../money/discounts.service';

function dateOnly(iso: string): Date {
  return new Date(iso);
}

function monthRange(year: number, month: number): { start: Date; end: Date } {
  const start = dateOnly(`${year}-${String(month).padStart(2, '0')}-01`);
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  const end = dateOnly(`${nextYear}-${String(nextMonth).padStart(2, '0')}-01`);
  return { start, end };
}

export interface ChildBillingContext {
  start: string;
  end: string;
  enrollmentWindows?: EnrollmentWindow[];
  billableDays: number;
  attendedDays: number;
  fixedDiscountsTiyin: bigint[];
  percentDiscountsBp: number[];
  workingDays: number;
  forceFullTariff: boolean;
}

@Injectable()
export class BillingRulesService {
  constructor(
    private readonly tenantPrisma: TenantPrisma,
    private readonly audit: AuditService,
    private readonly tariffs: TariffsService,
    private readonly discounts: DiscountsService,
  ) {}

  list() {
    return this.tenantPrisma.db.billingRules.findMany({ orderBy: { version: 'desc' } });
  }

  async get(id: string) {
    const row = await this.tenantPrisma.db.billingRules.findUnique({ where: { id } });
    if (!row) throw AppErrors.notFound('Billing rules version not found');
    return row;
  }

  /**
   * The version effective on a date, seeding version 1 (the confirmed
   * defaults) on first use if none exists yet. Never mutates an existing
   * row — every edit is version N+1 (03-billing-rules.md §1).
   */
  async activeOn(date: Date) {
    const row = await this.tenantPrisma.db.billingRules.findFirst({
      where: {
        effectiveFrom: { lte: date },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: date } }],
      },
      orderBy: { version: 'desc' },
    });
    if (row) return row;

    const anyExists = await this.tenantPrisma.db.billingRules.findFirst();
    if (anyExists) throw AppErrors.notFound('No billing rules version is effective on this date');

    // First-ever use: seed version 1 effective from the beginning of time.
    return this.tenantPrisma.db.billingRules.upsert({
      where: { tenantId_version: { tenantId: this.tenantPrisma.tenantId, version: 1 } },
      update: {},
      create: {
        tenantId: this.tenantPrisma.tenantId,
        version: 1,
        effectiveFrom: new Date('2000-01-01'),
        rules: DEFAULT_BILLING_RULES as any,
        note: 'Seeded defaults (03-billing-rules.md §2)',
      },
    });
  }

  /**
   * effectiveFrom cannot fall inside a closed accounting period
   * (03-billing-rules.md §7, 409 RULES_IN_CLOSED_PERIOD).
   */
  async create(ctx: AuthContext, rules: BillingRules, effectiveFrom: string, note?: string) {
    rules = validateBillingRules(rules);
    const effFrom = dateOnly(effectiveFrom);
    const period = await this.tenantPrisma.db.accountingPeriod.findFirst({
      where: { year: effFrom.getUTCFullYear(), month: effFrom.getUTCMonth() + 1 },
    });
    if (period?.status === 'closed') {
      throw AppErrors.conflict(
        'RULES_IN_CLOSED_PERIOD: effectiveFrom falls inside a closed period',
      );
    }

    return this.tenantPrisma.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM tenant WHERE id = ${ctx.tenantId}::uuid FOR UPDATE`;
      const latest = await tx.billingRules.findFirst({
        orderBy: { version: 'desc' },
      });
      const nextVersion = (latest?.version ?? 0) + 1;
      if (latest && effFrom <= latest.effectiveFrom)
        throw AppErrors.validationFailed('effectiveFrom must be after the latest rules version');

      // Close out the previous version's effective range so ranges never overlap
      // (the DB also enforces this with a GiST exclusion constraint).
      if (latest && !latest.effectiveTo) {
        const dayBefore = new Date(effFrom);
        dayBefore.setUTCDate(dayBefore.getUTCDate() - 1);
        await tx.billingRules.update({
          where: { id: latest.id },
          data: { effectiveTo: dayBefore },
        });
      }

      const created = await tx.billingRules.create({
        data: {
          tenantId: this.tenantPrisma.tenantId,
          version: nextVersion,
          effectiveFrom: effFrom,
          rules: rules as any,
          note,
          createdBy: ctx.userId,
        },
      });

      await this.audit.log(
        {
          userId: ctx.userId,
          action: 'billing_rules.create',
          entityType: 'billing_rules',
          entityId: created.id,
          newValue: { version: nextVersion, effectiveFrom },
        },
        tx,
      );
      return created;
    });
  }

  async diff(id: string, againstId: string) {
    const [a, b] = await Promise.all([this.get(id), this.get(againstId)]);
    return { a: { version: a.version, rules: a.rules }, b: { version: b.version, rules: b.rules } };
  }

  /**
   * Everything about a child that's shared across ALL of their tariffs for
   * a period — attendance and discounts are child-level, not tariff-level.
   * Computed once per child and reused across every tariff (tuition, meal,
   * transport, ...) the billing run charges them for.
   */
  async computeChildContext(
    childId: string,
    year: number,
    month: number,
    rules: BillingRules,
    db: any = this.tenantPrisma.db,
    window?: { start: Date; end: Date | null },
    frozen?: any,
  ): Promise<ChildBillingContext> {
    const child = await db.child.findUnique({ where: { id: childId } });
    if (!child) throw AppErrors.notFound('Child not found');

    const { start: periodStart, end: periodEnd } = monthRange(year, month);
    const [history, firstTariff] = frozen
      ? [[], null]
      : await Promise.all([
          db.childStatusHistory.findMany({
            where: { childId },
            orderBy: [{ effectiveDate: 'asc' }, { changedAt: 'asc' }],
          }),
          db.childTariff.findFirst({ where: { childId }, orderBy: { effectiveFrom: 'asc' } }),
        ]);
    const episodes: EnrollmentWindow[] = frozen
      ? (frozen.enrollmentWindows ?? [{ start: frozen.start, end: frozen.end }])
      : enrollmentWindows(
          periodStart,
          periodEnd,
          child,
          history,
          firstTariff?.effectiveFrom ?? null,
        );
    const windows = episodes
      .map((episode) => ({
        start: new Date(
          Math.max(new Date(episode.start).getTime(), window?.start.getTime() ?? -Infinity),
        ),
        end: new Date(
          Math.min(new Date(episode.end).getTime(), window?.end?.getTime() ?? Infinity),
        ),
      }))
      .filter((episode) => episode.start <= episode.end);
    const start = windows[0]?.start ?? periodStart;
    const end = windows.at(-1)?.end ?? new Date(periodStart.getTime() - 86400000);
    const setting = await db.setting.findUnique({
      where: { tenantId: this.tenantPrisma.tenantId },
    });
    const workingDays = setting?.workingDays ?? [1, 2, 3, 4, 5];
    const holidays: any[] = await db.holiday.findMany({
      where: {
        holidayDate: { gte: periodStart, lt: periodEnd },
        OR: [{ branchId: null }, { branchId: child.branchId }],
      },
    });
    const holidayDates = new Set<string>(
      holidays.filter((h) => !h.isWorking).map((h) => h.holidayDate.toISOString().slice(0, 10)),
    );
    const workingOverrideDates = new Set<string>(
      holidays.filter((h) => h.isWorking).map((h) => h.holidayDate.toISOString().slice(0, 10)),
    );
    const countWorking = (episode: { start: Date; end: Date }) =>
      billableDaysInWindow(
        year,
        month,
        workingDays,
        holidayDates,
        workingOverrideDates,
        episode.start,
        episode.end,
      );
    // The divisor is shared across tariff segments; working days are intersected with each segment.
    const billableDays =
      frozen?.billableDays ??
      (rules.attendance.divisor === 'actual_working_days' &&
      rules.proration.divisorRespectsEnrollmentWindow
        ? episodes.reduce(
            (sum, episode) =>
              sum + countWorking({ start: new Date(episode.start), end: new Date(episode.end) }),
            0,
          )
        : resolveBillableDays(
            rules,
            year,
            month,
            workingDays,
            holidayDates,
            workingOverrideDates,
            null,
          ));
    const attendanceRows: any[] = windows.length
      ? await db.attendanceDay.findMany({
          where: {
            childId,
            OR: windows.map((episode) => ({
              attendanceDate: { gte: episode.start, lte: episode.end },
            })),
          },
        })
      : [];
    const attendedDays = attendanceRows.filter((a) =>
      rules.attendance.billableStatuses.includes(a.status),
    ).length;
    const activeDiscounts: any[] = await db.discount.findMany({
      where: {
        childId,
        revokedAt: null,
        validFrom: { lte: start },
        OR: [{ validTo: null }, { validTo: { gte: start } }],
      },
    });
    const fixedDiscountsTiyin = activeDiscounts
      .filter((d) => d.kind === 'fixed')
      .map((d) => d.valueTiyin!);
    const percentDiscountsBp = activeDiscounts
      .filter((d) => d.kind === 'percent')
      .map((d) => d.valueBp!);
    const eligibleWorkingDays = windows.reduce((sum, episode) => sum + countWorking(episode), 0);
    const forceFullTariff = episodes.some(
      (episode) =>
        (new Date(episode.start) > periodStart &&
          rules.proration.enrollmentMidMonth === 'full_month') ||
        (new Date(episode.end) < new Date(periodEnd.getTime() - 86400000) &&
          rules.proration.withdrawalMidMonth === 'full_month'),
    );
    return {
      start: start.toISOString(),
      end: end.toISOString(),
      enrollmentWindows: windows.map((episode) => ({
        start: episode.start.toISOString(),
        end: episode.end.toISOString(),
      })),
      billableDays,
      attendedDays,
      fixedDiscountsTiyin: frozen ? frozen.fixedDiscountsTiyin.map(BigInt) : fixedDiscountsTiyin,
      percentDiscountsBp: frozen?.percentDiscountsBp ?? percentDiscountsBp,
      workingDays: frozen?.workingDays ?? eligibleWorkingDays,
      forceFullTariff: frozen?.forceFullTariff ?? forceFullTariff,
    };
  }

  /**
   * Dry run — writes nothing to charge/payment (03-billing-rules.md §7).
   * Simulates ONE tariff/charge (the child's primary tariff, or the first
   * one found) for quick "what would this bill to" checks. The real
   * billing run charges every tariff a child holds — see billing-runs.service.ts.
   */
  async simulateForChild(
    childId: string,
    year: number,
    month: number,
    rulesOverride?: BillingRules,
  ) {
    await this.tenantPrisma.assertChild(childId, 'billing_rules:manage');
    const { start: periodStart } = monthRange(year, month);
    const rulesRow = rulesOverride ? null : await this.activeOn(periodStart);
    const rules = validateBillingRules(rulesOverride ?? rulesRow!.rules);

    const tariffAssignment = (
      await this.tariffs.activeTariffsFor(childId, periodStart, new Date(Date.UTC(year, month, 0)))
    ).at(0);
    if (!tariffAssignment) {
      throw AppErrors.validationFailed('NO_ACTIVE_TARIFF: child has no tariff for this period');
    }

    const context = await this.computeChildContext(
      childId,
      year,
      month,
      rules,
      this.tenantPrisma.db,
      { start: tariffAssignment.effectiveFrom, end: tariffAssignment.effectiveTo },
    );

    const result = calculateCharge(
      {
        baseTiyin: tariffAssignment.tariff.amountTiyin,
        kind: tariffAssignment.tariff.kind as any,
        ...context,
      },
      rules,
    );

    return {
      childId,
      tariffId: tariffAssignment.tariffId,
      attendedDays: context.attendedDays,
      billableDays: context.billableDays,
      amountTiyin: result.amountTiyin.toString(),
      trace: result.trace.map((t) => ({ ...t, amount: t.amount.toString() })),
    };
  }
}
