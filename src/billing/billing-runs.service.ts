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
import { BillingRules } from './billing-rules.types';

function dateOnly(iso: string): Date {
  return new Date(iso);
}

export interface PreviewLine {
  childId: string;
  tariffId: string;
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
  private async computeAllLines(
    year: number,
    month: number,
    rules: BillingRules,
  ): Promise<PreviewLine[]> {
    const periodStart = dateOnly(`${year}-${String(month).padStart(2, '0')}-01`);
    const childIds = await this.tariffs.childrenWithActiveTariffs(periodStart);

    const lines: PreviewLine[] = [];
    for (const childId of childIds) {
      const context = await this.billingRules.computeChildContext(childId, year, month, rules);
      const tariffAssignments = await this.tariffs.activeTariffsFor(childId, periodStart);

      for (const assignment of tariffAssignments) {
        const result = calculateCharge(
          {
            baseTiyin: assignment.tariff.amountTiyin,
            kind: assignment.tariff.kind as any,
            ...context,
          },
          rules,
        );
        lines.push({
          childId,
          tariffId: assignment.tariffId,
          kind: assignment.tariff.kind,
          amountTiyin: result.amountTiyin.toString(),
          attendedDays: context.attendedDays,
          billableDays: context.billableDays,
          trace: result.trace.map((t) => ({ ...t, amount: t.amount.toString() })),
        });
      }
    }
    return lines;
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

  async get(id: string) {
    const run = await this.tenantPrisma.db.billingRun.findUnique({
      where: { id },
      include: { accountingPeriod: true },
    });
    if (!run) throw AppErrors.notFound('Billing run not found');

    if (run.status === 'committed') {
      const charges = await this.tenantPrisma.db.charge.findMany({
        where: { billingRunId: id, sign: 1 },
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
    await this.tenantPrisma.db.billingRun.update({ where: { id }, data: { status: 'discarded' } });
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
        return this.get(id); // idempotent replay
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
    const lines = await this.computeAllLines(period.year, period.month, rules);

    const setting = await this.tenantPrisma.db.setting.findUnique({
      where: { tenantId: this.tenantPrisma.tenantId },
    });
    const dueDay = setting?.paymentDueDay ?? 5;
    // Arrears billing: charges for period (year, month) fall due in the following month.
    const dueDate = new Date(Date.UTC(period.year, period.month, dueDay)); // JS month is 0-indexed = next month

    const total = lines.reduce((acc, l) => acc + BigInt(l.amountTiyin), 0n);
    const childCount = new Set(lines.map((l) => l.childId)).size;

    // No explicit row lock on `run` here (unlike payments.service.ts's
    // FIFO allocator) — the backstop is the DB itself: uq_charge_once
    // (one non-manual charge per tenant/child/period/kind) and
    // uq_billing_run_committed (one committed run per tenant/period) both
    // make a second, concurrent commit of the same preview fail at the
    // database layer. Caught below and turned into a clean 409 — without
    // this catch, a genuinely legitimate race (two staff members
    // committing at the same moment) surfaced as an unhandled 500
    // (confirmed while adding the concurrency e2e coverage; see
    // test/billing-concurrency.e2e-spec.ts).
    try {
      await this.tenantPrisma.db.$transaction(async (tx) => {
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
              tariffSnapshot: tariff as any,
              calculationTrace: line.trace as any,
              dueDate,
              createdBy: ctx.userId,
            },
          });
        }

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
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw AppErrors.conflict(
          'CONCURRENT_COMMIT: this billing run was committed by a concurrent request',
        );
      }
      throw e;
    }

    await this.audit.log({
      userId: ctx.userId,
      action: 'billing.commit',
      entityType: 'billing_run',
      entityId: id,
      newValue: { periodId: run.periodId, childCount, totalTiyin: total.toString() },
    });

    // Never send inside the request that triggered it (§4) — queue only,
    // and never let a notification problem fail a committed billing run.
    void this.notifyChargesCreated(run.id, period.year, period.month, dueDate, lines);

    return this.get(id);
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
