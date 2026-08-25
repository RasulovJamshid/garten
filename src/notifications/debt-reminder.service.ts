import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ContextIdFactory, ModuleRef } from '@nestjs/core';
import { PrismaService } from '../prisma/prisma.service';
import { AuthenticatedRequest } from '../common/request-context';
import { PgBossService } from '../jobs/pgboss.service';
import { NotificationsService } from './notifications.service';

const DEBT_REMINDER_QUEUE = 'notification.debt-reminder-sweep';

function toBigInt(v: unknown): bigint {
  if (v === null || v === undefined) return 0n;
  return BigInt(v.toString());
}

/** ISO year-week, e.g. "2026-W31" — the dedup granularity for reminders (at most one per child per week). */
function isoWeekStamp(d: Date): string {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

/**
 * Nightly sweep across every tenant (05-telegram-spec.md §5 debt_reminder
 * template — nothing triggered it automatically until now). Runs outside
 * any HTTP request, hence raw PrismaService (see .eslintrc.js exemption)
 * and the same ModuleRef+ContextIdFactory trick as ExportWorkerService to
 * get a real, tenant-scoped NotificationsService without duplicating its
 * dedup/render/enqueue logic.
 */
@Injectable()
export class DebtReminderService implements OnApplicationBootstrap {
  private readonly logger = new Logger(DebtReminderService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly boss: PgBossService,
    private readonly moduleRef: ModuleRef,
  ) {}

  onApplicationBootstrap(): void {
    // Deliberately not awaited: PgBossService.schedule()/work() both await
    // pg-boss's own startup internally, and Nest does not guarantee
    // JobsModule's onApplicationBootstrap runs before this one (see
    // PgBossService's class comment). An `async` hook that awaits it
    // directly would make Nest wait on this promise before moving on to
    // *any* other module's bootstrap hook, including the one that would
    // resolve it — a deadlock. Fire-and-forget, same as
    // ExportWorkerService/NotificationWorkerService.
    //
    // 08:00 Asia/Tashkent, daily. Only children with a genuinely overdue
    // balance (8+ days) are reminded — not everyone with any debt at all,
    // which would fire the day after every single billing run.
    this.boss
      .schedule(DEBT_REMINDER_QUEUE, '0 8 * * *', {}, { tz: 'Asia/Tashkent' })
      .then(() => this.boss.work(DEBT_REMINDER_QUEUE, { localConcurrency: 1 }, () => this.run()))
      .catch((e: Error) =>
        this.logger.error(`Failed to schedule/register ${DEBT_REMINDER_QUEUE}: ${e.message}`),
      );
  }

  private async run(): Promise<void> {
    const tenants = await this.prisma.tenant.findMany({
      where: { status: 'active' },
      select: { id: true },
    });
    for (const tenant of tenants) {
      await this.runForTenant(tenant.id).catch((e: Error) =>
        this.logger.error(`Debt reminder sweep failed for tenant ${tenant.id}: ${e.message}`),
      );
    }
  }

  private async runForTenant(tenantId: string): Promise<void> {
    const overdue = await this.prisma.$queryRaw<{ child_id: string; overdue: unknown }[]>`
      SELECT child_id, (COALESCE(d8_30, 0) + COALESCE(d30_plus, 0)) AS overdue
      FROM v_debt_ageing
      WHERE tenant_id = ${tenantId}::uuid AND (COALESCE(d8_30, 0) + COALESCE(d30_plus, 0)) > 0
    `;
    if (overdue.length === 0) return;

    const contextId = ContextIdFactory.create();
    const fakeRequest = {
      user: { sub: 'system', tid: tenantId, bid: [] },
    } as unknown as AuthenticatedRequest;
    this.moduleRef.registerRequestByContextId(fakeRequest, contextId);
    const notifications = await this.moduleRef.resolve(NotificationsService, contextId, {
      strict: false,
    });

    const weekStamp = isoWeekStamp(new Date());

    for (const row of overdue) {
      const amountTiyin = toBigInt(row.overdue);
      if (amountTiyin <= 0n) continue;

      const [links, earliestDue] = await Promise.all([
        this.prisma.childGuardian.findMany({
          where: { childId: row.child_id },
          select: { guardianId: true },
        }),
        // Earliest still-outstanding charge's due date — cancellation/
        // reversal-aware, same "outstanding" shape used throughout
        // payments.service.ts / charges.service.ts.
        this.prisma.$queryRaw<{ due: Date | null }[]>`
          SELECT MIN(c.due_date) AS due
          FROM charge c
          WHERE c.child_id = ${row.child_id}::uuid AND c.tenant_id = ${tenantId}::uuid AND c.sign = 1
            AND NOT EXISTS (SELECT 1 FROM charge r WHERE r.source_charge_id = c.id)
            AND c.amount_tiyin > COALESCE((
              SELECT SUM(pa.amount_tiyin) FROM payment_allocation pa
              JOIN payment p ON p.id = pa.payment_id
              WHERE pa.charge_id = c.id
                AND NOT EXISTS (SELECT 1 FROM payment rp WHERE rp.source_payment_id = p.id)
            ), 0)
        `,
      ]);
      if (links.length === 0) continue;

      const due = earliestDue[0]?.due;
      try {
        await notifications.send({
          templateKey: 'debt_reminder',
          recipients: links.map((l) => ({ guardianId: l.guardianId })),
          channel: 'telegram',
          data: {
            amount: (Number(amountTiyin) / 100).toFixed(2),
            due: due ? due.toISOString().slice(0, 10) : '—',
          },
          entityId: `debt-reminder:${weekStamp}`,
        });
      } catch (e) {
        this.logger.warn(
          `debt_reminder send failed for child ${row.child_id}: ${(e as Error).message}`,
        );
      }
    }
  }
}
