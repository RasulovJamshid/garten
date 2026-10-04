import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { TenantPrisma } from '../prisma/tenant-prisma.provider';
import { AuditService } from '../audit/audit.service';
import { AppErrors } from '../common/exceptions/app.exception';
import { AuthContext } from '../common/auth-context';
import { BillingRulesService } from './billing-rules.service';
import { TariffsService } from '../money/tariffs.service';
import { PeriodsService } from '../money/periods.service';
import { NotificationsService } from '../notifications/notifications.service';
import { calculateCharge } from './calculate-charge';
import { allocateCredit } from '../payments/allocate-credit';
import { validateBillingRules } from './validate-billing-rules';
import { BillingRules } from './billing-rules.types';

function dateOnly(iso: string): Date {
  return new Date(iso);
}

export interface PreviewLine {
  childId: string;
  tariffId: string;
  childName: string;
  tariffName: string;
  tariffSnapshot: any;
  kind: string;
  amountTiyin: string;
  attendedDays: number;
  billableDays: number;
  trace: { step: string; amount: string; note?: string; factor?: string }[];
}

@Injectable()
export class BillingRunsService {
  private readonly logger = new Logger(BillingRunsService.name);

  constructor(
    private readonly tenantPrisma: TenantPrisma,
    private readonly audit: AuditService,
    private readonly billingRules: BillingRulesService,
    private readonly tariffs: TariffsService,
    private readonly periods: PeriodsService,
    private readonly notifications: NotificationsService,
  ) {}

  /** Shared by preview() and commit() — recomputed fresh both times, never trusted stale. */
  async computeAllLines(
    year: number,
    month: number,
    rules: BillingRules,
    db: any = this.tenantPrisma.db,
    onlyChildId?: string,
    snapshotAssignments?: any[],
    frozenContext?: any,
  ): Promise<PreviewLine[]> {
    rules = validateBillingRules(rules);
    const periodStart = new Date(Date.UTC(year, month - 1, 1));
    const periodEnd = new Date(Date.UTC(year, month, 0));
    const childIds = onlyChildId
      ? [onlyChildId]
      : await this.tariffs.childrenWithActiveTariffs(periodStart, periodEnd, db);
    const lines: PreviewLine[] = [];
    for (const childId of childIds) {
      const child = await db.child.findUnique({ where: { id: childId } });
      const assignments =
        snapshotAssignments ??
        (await this.tariffs.activeTariffsFor(childId, periodStart, periodEnd, db));
      const kinds = new Map<string, any[]>();
      for (const a of assignments)
        kinds.set(a.tariff.kind, [...(kinds.get(a.tariff.kind) ?? []), a]);
      for (const [kind, segments] of kinds) {
        if (
          !snapshotAssignments &&
          kind === 'registration_fee' &&
          (await db.charge.findFirst({
            where: { childId, kind, sign: 1, otherCharge: { none: { sign: -1 } } },
          }))
        )
          continue;
        let total = 0n;
        let attendedDays = 0;
        const trace: PreviewLine['trace'] = [];
        const snapshots: any[] = [];
        const context = await this.billingRules.computeChildContext(
          childId,
          year,
          month,
          rules,
          db,
          undefined,
          frozenContext,
        );
        for (const segment of segments) {
          const part = await this.billingRules.computeChildContext(
            childId,
            year,
            month,
            rules,
            db,
            { start: segment.effectiveFrom, end: segment.effectiveTo },
            segment.billingContext,
          );
          const segmentRules = structuredClone(rules);
          if (!rules.discount.applyBeforeAttendance) segmentRules.discount.appliesTo = [];
          if (
            segments.length > 1 &&
            (segmentRules.attendanceByKind[kind as keyof typeof segmentRules.attendanceByKind] ??
              segmentRules.attendance.mode) === 'flat_monthly'
          ) {
            segmentRules.attendanceByKind[kind as keyof typeof segmentRules.attendanceByKind] =
              'per_working_day';
          }
          // Round the total once; individual attendance division remains integer-rounded.
          if (segments.length > 1) {
            segmentRules.attendance.noAttendanceBehaviour = 'zero';
            if (
              context.forceFullTariff ||
              (context.attendedDays === 0 &&
                rules.attendance.noAttendanceBehaviour === 'full_tariff')
            ) {
              segmentRules.attendanceByKind[kind as keyof typeof segmentRules.attendanceByKind] =
                'per_working_day';
              if (context.forceFullTariff) part.billableDays = context.workingDays;
            }
          }
          segmentRules.rounding.unit = 'tiyin';
          segmentRules.discount.floorTiyin = '0';
          const result = calculateCharge(
            {
              baseTiyin: segment.tariff.amountTiyin,
              kind: kind as any,
              ...part,
              forceFullTariff: segments.length === 1 && part.forceFullTariff,
            },
            segmentRules,
          );
          total += result.amountTiyin;
          attendedDays += part.attendedDays;
          trace.push(
            ...result.trace.map((t) => ({
              ...t,
              amount: t.amount.toString(),
              note: [segment.tariff.name, t.note].filter(Boolean).join(': '),
            })),
          );
          snapshots.push({
            ...segment.tariff,
            billingContext: { ...part, fixedDiscountsTiyin: part.fixedDiscountsTiyin.map(String) },
            amountTiyin: segment.tariff.amountTiyin.toString(),
            effectiveFrom: segment.effectiveFrom.toISOString(),
            effectiveTo: segment.effectiveTo?.toISOString() ?? null,
          });
        }
        if (
          segments.length > 1 &&
          context.attendedDays === 0 &&
          rules.attendance.noAttendanceBehaviour === 'min_charge' &&
          (rules.attendanceByKind[kind as keyof typeof rules.attendanceByKind] ??
            rules.attendance.mode) === 'per_attended_day' &&
          !context.forceFullTariff
        )
          total = BigInt(rules.attendance.minChargeTiyin);
        const finalRules = structuredClone(rules);
        finalRules.attendanceByKind[kind as keyof typeof finalRules.attendanceByKind] =
          'flat_monthly';
        finalRules.discount.applyBeforeAttendance = false;
        if (rules.discount.applyBeforeAttendance) finalRules.discount.appliesTo = [];
        const final = calculateCharge(
          { baseTiyin: total, kind: kind as any, ...context },
          finalRules,
        );
        trace.push(
          ...final.trace
            .filter((t) => t.step !== 'base')
            .map((t) => ({ ...t, amount: t.amount.toString() })),
        );
        lines.push({
          childId,
          childName: [child.firstName, child.lastName].join(' '),
          tariffId: segments[0].tariffId,
          tariffName: segments.map((a) => a.tariff.name).join(' / '),
          kind,
          amountTiyin: final.amountTiyin.toString(),
          attendedDays,
          billableDays: context.billableDays,
          trace,
          tariffSnapshot: {
            segments: snapshots,
            context: { ...context, fixedDiscountsTiyin: context.fixedDiscountsTiyin.map(String) },
          },
        });
      }
    }
    return lines;
  }

  async list(periodId?: string, status?: string) {
    const runs = await this.tenantPrisma.db.billingRun.findMany({
      where: { periodId, status },
      include: { accountingPeriod: true },
      orderBy: { createdAt: 'desc' },
    });
    return Promise.all(runs.map((run) => this.restrictRun(run, 'charge:read')));
  }

  async preview(ctx: AuthContext, year: number, month: number) {
    const period = await this.periods.getOrCreate(year, month);
    if (period.status === 'closed') {
      throw AppErrors.periodClosed(`Accounting period ${year}-${month} is closed`);
    }

    const existingCommitted = await this.tenantPrisma.db.billingRun.findFirst({
      where: { periodId: period.id, status: 'committed' },
    });
    if (existingCommitted) {
      throw AppErrors.conflict(
        'BILLING_ALREADY_COMMITTED: this period already has a committed run',
      );
    }

    const rulesRow = await this.billingRules.activeOn(
      dateOnly(`${year}-${String(month).padStart(2, '0')}-01`),
    );
    const rules = rulesRow.rules as unknown as BillingRules;
    const lines = await this.computeAllLines(year, month, rules);

    const total = lines.reduce((acc, l) => acc + BigInt(l.amountTiyin), 0n);
    const childCount = new Set(lines.map((l) => l.childId)).size;

    const run = await this.tenantPrisma.db.billingRun.create({
      data: {
        tenantId: this.tenantPrisma.tenantId,
        periodId: period.id,
        billingRulesId: rulesRow.id,
        status: 'preview',
        childCount,
        totalTiyin: total,
        previewData: lines as any,
        createdBy: ctx.userId,
      },
    });

    return { ...run, lines };
  }

  private async restrictRun<
    T extends { previewData: any; totalTiyin: bigint | null; childCount: number | null },
  >(run: T, permission: string): Promise<T> {
    if (this.tenantPrisma.context.scopeFor(permission) === 'all') return run;
    const children = await this.tenantPrisma.db.child.findMany({
      where: this.tenantPrisma.childWhere(permission),
      select: { id: true },
    });
    const ids = new Set(children.map((child) => child.id));
    const lines = (Array.isArray(run.previewData) ? run.previewData : []).filter((line: any) =>
      ids.has(line.childId),
    );
    return {
      ...run,
      previewData: lines,
      totalTiyin: lines.reduce((total: bigint, line: any) => total + BigInt(line.amountTiyin), 0n),
      childCount: new Set(lines.map((line: any) => line.childId)).size,
    };
  }

  async get(id: string, permission = 'charge:read') {
    const found = await this.tenantPrisma.db.billingRun.findUnique({
      where: { id },
      include: { accountingPeriod: true },
    });
    if (!found) throw AppErrors.notFound('Billing run not found');
    const run = await this.restrictRun(found, permission);
    if (!run) throw AppErrors.notFound('Billing run not found');

    if (run.status === 'committed') {
      const charges = await this.tenantPrisma.db.charge.findMany({
        where: { billingRunId: id, sign: 1, child: this.tenantPrisma.childWhere(permission) },
      });
      return { ...run, charges };
    }
    return { ...run, lines: run.previewData };
  }

  async explainChild(id: string, childId: string) {
    const run = await this.get(id);
    if ('charges' in run) {
      return (run.charges as any[]).filter((c) => c.childId === childId);
    }
    return ((run.lines as unknown as PreviewLine[]) ?? []).filter((l) => l.childId === childId);
  }

  async discard(ctx: AuthContext, id: string) {
    const run = await this.tenantPrisma.db.billingRun.findUnique({ where: { id } });
    if (!run) throw AppErrors.notFound('Billing run not found');
    if (run.status !== 'preview') {
      throw AppErrors.conflict('Only a preview run can be discarded');
    }
    const changed = await this.tenantPrisma.db.billingRun.updateMany({
      where: { id, status: 'preview' },
      data: { status: 'discarded' },
    });
    if (changed.count !== 1) throw AppErrors.conflict('BILLING_RUN_CHANGED');
  }

  /**
   * Idempotency-Key required (api-spec §9). A second commit attempt with
   * the SAME key on an already-committed run replays the original result;
   * a different key on an already-committed run is a genuine conflict.
   * The DB's partial unique index (one committed run per period) and the
   * `uq_charge_once` index are the ultimate backstops either way.
   */
  async commit(ctx: AuthContext, id: string, idempotencyKey: string) {
    const run = await this.tenantPrisma.db.billingRun.findUnique({ where: { id } });
    if (!run) throw AppErrors.notFound('Billing run not found');

    if (run.status === 'committed') {
      if (run.idempotencyKey === idempotencyKey) {
        return this.get(id, 'charge:generate'); // idempotent replay
      }
      throw AppErrors.conflict(
        'IDEMPOTENCY_CONFLICT: this run was already committed under a different key',
      );
    }
    if (run.status !== 'preview') {
      throw AppErrors.conflict(`Cannot commit a run in status '${run.status}'`);
    }

    const period = await this.periods.findOneOrThrow(run.periodId);
    if (period.status === 'closed') {
      throw AppErrors.periodClosed(`Accounting period ${period.year}-${period.month} is closed`);
    }

    const rulesRow = await this.billingRules.get(run.billingRulesId);
    const rules = rulesRow.rules as unknown as BillingRules;
    let lines = await this.computeAllLines(period.year, period.month, rules);

    const setting = await this.tenantPrisma.db.setting.findUnique({
      where: { tenantId: this.tenantPrisma.tenantId },
    });
    const dueDay = setting?.paymentDueDay ?? 5;
    // Arrears billing: charges for period (year, month) fall due in the following month.
    const dueDate = new Date(Date.UTC(period.year, period.month, dueDay)); // JS month is 0-indexed = next month

    let total = lines.reduce((acc, l) => acc + BigInt(l.amountTiyin), 0n);
    let childCount = new Set(lines.map((l) => l.childId)).size;

    // Row locks serialize commits; unique indexes remain the final backstop.
    let committedNow = false;
    try {
      await this.tenantPrisma.db.$transaction(
        async (tx) => {
          await tx.$queryRaw`SELECT id FROM billing_run WHERE id = ${id}::uuid AND tenant_id = ${ctx.tenantId}::uuid FOR UPDATE`;
          const current = await tx.billingRun.findUniqueOrThrow({ where: { id } });
          if (current.status !== 'preview') {
            if (current.status === 'committed' && current.idempotencyKey === idempotencyKey) return;
            throw AppErrors.conflict('BILLING_RUN_CHANGED: reload the run');
          }
          const candidateIds = await this.tariffs.childrenWithActiveTariffs(
            new Date(Date.UTC(period.year, period.month - 1, 1)),
            new Date(Date.UTC(period.year, period.month, 0)),
            tx,
          );
          for (const childId of [...candidateIds].sort())
            await tx.$queryRaw`SELECT id FROM child WHERE id = ${childId}::uuid AND tenant_id = ${ctx.tenantId}::uuid FOR UPDATE`;
          const fresh = await this.computeAllLines(period.year, period.month, rules, tx);
          const signature = (items: any[]) =>
            JSON.stringify(
              items
                .map((l) => [l.childId, l.kind, l.amountTiyin, l.attendedDays, l.billableDays])
                .sort(),
            );
          if (signature(fresh) !== signature((run.previewData ?? []) as any[]))
            throw AppErrors.conflict(
              'BILLING_PREVIEW_STALE: attendance or tariff data changed; create a new preview',
            );
          lines = fresh;
          total = lines.reduce((acc, line) => acc + BigInt(line.amountTiyin), 0n);
          childCount = new Set(lines.map((line) => line.childId)).size;
          committedNow = true;
          for (const line of lines) {
            const tariff = await tx.tariff.findUnique({ where: { id: line.tariffId } });
            await tx.charge.create({
              data: {
                tenantId: this.tenantPrisma.tenantId,
                branchId:
                  tariff!.branchId ??
                  (await tx.child.findUnique({ where: { id: line.childId } }))!.branchId,
                childId: line.childId,
                periodId: run.periodId,
                billingRunId: run.id,
                billingRulesId: rulesRow.id,
                kind: line.kind,
                amountTiyin: BigInt(line.amountTiyin),
                sign: 1,
                tariffSnapshot: line.tariffSnapshot,
                calculationTrace: line.trace as any,
                dueDate,
                createdBy: ctx.userId,
              },
            });
          }

          for (const childId of new Set(lines.map((l) => l.childId)))
            await allocateCredit(tx, ctx.tenantId, childId);

          await tx.billingRun.update({
            where: { id },
            data: {
              status: 'committed',
              committedAt: new Date(),
              idempotencyKey,
              totalTiyin: total,
              childCount,
            },
          });
          await this.audit.log(
            {
              userId: ctx.userId,
              action: 'billing.commit',
              entityType: 'billing_run',
              entityId: id,
              newValue: { periodId: run.periodId, childCount, totalTiyin: total.toString() },
            },
            tx,
          );
        },
        { timeout: 60000 },
      );
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw AppErrors.conflict(
          'CONCURRENT_COMMIT: this billing run was committed by a concurrent request',
        );
      }
      throw e;
    }

    if (!committedNow) return this.get(id, 'charge:generate');

    // Never send inside the request that triggered it (§4) — queue only,
    // and never let a notification problem fail a committed billing run.
    void this.notifyChargesCreated(run.id, period.year, period.month, dueDate, lines);

    return this.get(id, 'charge:generate');
  }

  /**
   * One notification per child, not per charge line — a child with
   * tuition + meal + transport tariffs gets three charge rows but should
   * get a single "you have a new charge" message, not three.
   */
  private async notifyChargesCreated(
    billingRunId: string,
    year: number,
    month: number,
    dueDate: Date,
    lines: PreviewLine[],
  ): Promise<void> {
    try {
      const totalByChild = new Map<string, bigint>();
      for (const line of lines) {
        totalByChild.set(
          line.childId,
          (totalByChild.get(line.childId) ?? 0n) + BigInt(line.amountTiyin),
        );
      }

      for (const [childId, amountTiyin] of totalByChild) {
        const links = await this.tenantPrisma.db.childGuardian.findMany({
          where: { childId },
          select: { guardianId: true },
        });
        if (links.length === 0) continue;

        await this.notifications.send({
          templateKey: 'charge_created',
          recipients: links.map((l) => ({ guardianId: l.guardianId })),
          channel: 'telegram',
          data: {
            month: `${year}-${String(month).padStart(2, '0')}`,
            amount: (Number(amountTiyin) / 100).toFixed(2),
            due: dueDate.toISOString().slice(0, 10),
          },
          entityId: `${billingRunId}:${childId}`,
        });
      }
    } catch (e) {
      this.logger.warn(`notifyChargesCreated failed: ${(e as Error).message}`);
    }
  }
}
