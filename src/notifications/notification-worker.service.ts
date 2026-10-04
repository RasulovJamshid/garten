import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import type { JobWithMetadata } from 'pg-boss';
import { PrismaService } from '../prisma/prisma.service';
import { AppConfigService } from '../config/app-config.service';
import { PgBossService } from '../jobs/pgboss.service';
import { TelegramClient } from '../telegram/telegram-client.service';
import { TelegramBindingService } from '../telegram/telegram-binding.service';
import { NOTIFICATION_SEND_QUEUE, NotificationJobData } from './notifications.service';

/**
 * The pg-boss consumer side of the sending pipeline (§4):
 *   notification row (queued) -> this worker -> Telegram sendMessage -> status update
 *
 * Runs outside any HTTP request, so it can't use TenantPrisma — see the
 * ESLint exemption comment in .eslintrc.js for why this file specifically
 * is allowed to inject raw PrismaService.
 */
@Injectable()
export class NotificationWorkerService implements OnApplicationBootstrap {
  private readonly logger = new Logger(NotificationWorkerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
    private readonly boss: PgBossService,
    private readonly telegram: TelegramClient,
    private readonly binding: TelegramBindingService,
  ) {}

  onApplicationBootstrap(): void {
    void this.boss
      .work('notification.recover', { localConcurrency: 1 }, async () => {
        if (!this.telegram.enabled) return;
        const queued = await this.prisma.notification.findMany({
          where: { status: 'queued' },
          select: { id: true, tenantId: true },
          take: 1000,
          orderBy: { queuedAt: 'asc' },
        });
        for (const row of queued)
          await this.boss.send(
            NOTIFICATION_SEND_QUEUE,
            { notificationId: row.id, tenantId: row.tenantId },
            { singletonKey: row.id, retryLimit: 3, retryBackoff: true, retryDelay: 2 },
          );
      })
      .then(() => this.boss.schedule('notification.recover', '* * * * *', {}))
      .catch((e) => this.logger.error(e));
    this.boss
      .work<NotificationJobData>(
        NOTIFICATION_SEND_QUEUE,
        { localConcurrency: this.config.get('JOB_CONCURRENCY') },
        (job) => this.processJob(job),
      )
      .catch((e: Error) =>
        this.logger.error(`Failed to register ${NOTIFICATION_SEND_QUEUE} worker: ${e}`),
      );
  }

  private async processJob(job: JobWithMetadata<NotificationJobData>): Promise<void> {
    const failure = await this.prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM notification WHERE id = ${job.data.notificationId}::uuid AND tenant_id = ${job.data.tenantId}::uuid FOR UPDATE`;
        return this.processLocked(job, tx);
      },
      { timeout: 60000 },
    );
    if (failure) throw failure;
  }

  private async processLocked(
    job: JobWithMetadata<NotificationJobData>,
    db: any,
  ): Promise<Error | void> {
    const notification = await db.notification.findFirst({
      where: { id: job.data.notificationId, tenantId: job.data.tenantId },
    });
    // Already handled by an earlier attempt (or the row was somehow
    // removed) — nothing to do, and definitely nothing to retry.
    if (!notification || notification.status !== 'queued') return;

    if (notification.announcementId) {
      const announcement = await db.announcement.findFirst({
        where: { id: notification.announcementId, tenantId: job.data.tenantId },
      });
      if (
        !announcement ||
        announcement.deletedAt ||
        (announcement.expiresAt && announcement.expiresAt <= new Date())
      ) {
        await db.notification.update({
          where: { id: notification.id },
          data: { status: 'skipped', lastError: 'Announcement removed or expired' },
        });
        return;
      }
      if (announcement.publishAt && announcement.publishAt > new Date()) {
        await this.boss.send(NOTIFICATION_SEND_QUEUE, job.data, {
          startAfter: announcement.publishAt,
          singletonKey: notification.id,
        });
        return;
      }
    }
    if (notification.channel === 'internal') {
      // "Internal" means it sits in the system for the admin to relay by
      // phone (§8.2) — there's nothing further to deliver.
      await db.notification.update({
        where: { id: notification.id },
        data: { status: 'sent', sentAt: new Date() },
      });
      return;
    }

    if (notification.channel !== 'telegram') {
      // sms/email have no provider wired in Stage 1 (05-telegram-spec.md
      // §1 — SMS requires a paid contract not yet in place).
      await db.notification.update({
        where: { id: notification.id },
        data: {
          status: 'skipped',
          lastError: `channel "${notification.channel}" not implemented in Stage 1`,
        },
      });
      return;
    }

    if (!this.telegram.enabled) {
      // TELEGRAM_ENABLED=false -> notifications queue but never send
      // (§9 — the test that stops CI from messaging real parents). Leave
      // status='queued' untouched and complete this job as a no-op; it
      // will simply never be picked up again until enabled.
      return;
    }

    const activeBinding = await this.binding.findActiveBinding(job.data.tenantId, {
      guardianId: notification.recipientGuardianId ?? undefined,
      userId: notification.recipientUserId ?? undefined,
    });

    if (!activeBinding) {
      await db.notification.update({
        where: { id: notification.id },
        data: { status: 'skipped', lastError: 'recipient is not bound to Telegram' },
      });
      return;
    }

    if (activeBinding.blockedBot) {
      await db.notification.update({
        where: { id: notification.id },
        data: { status: 'failed', lastError: 'bot was previously blocked by this recipient' },
      });
      return;
    }

    const result = await this.telegram.sendMessage(activeBinding.chatId, notification.renderedBody);

    if (result.ok) {
      await db.notification.update({
        where: { id: notification.id },
        data: { status: 'sent', sentAt: new Date(), attempts: { increment: 1 } },
      });
      return;
    }

    switch (result.kind) {
      case 'rate_limited':
        // "Does not count toward the attempt limit" (§4 retry table) — so
        // rather than throw (which would consume one of pg-boss's own
        // retryLimit attempts), reschedule a fresh job after exactly
        // retry_after and complete this one normally. Status stays
        // 'queued' throughout.
        await this.boss.send(NOTIFICATION_SEND_QUEUE, job.data, {
          startAfter: result.retryAfterSeconds,
        });
        return;

      case 'blocked':
        await this.binding.markBlocked(activeBinding.id);
        await db.notification.update({
          where: { id: notification.id },
          data: {
            status: 'failed',
            lastError: '403 bot was blocked by the user',
            attempts: { increment: 1 },
          },
        });
        return;

      case 'chat_not_found':
        await this.binding.markUnboundById(activeBinding.id);
        await db.notification.update({
          where: { id: notification.id },
          data: {
            status: 'failed',
            lastError: '400 chat not found (stale binding)',
            attempts: { increment: 1 },
          },
        });
        return;

      case 'other': {
        // 5xx / network: exponential backoff, max 3 attempts (§4). We
        // drive that decision ourselves off job.retryCount rather than
        // just always throwing, so the *final* attempt writes a
        // definitive 'failed' row instead of leaving it implicitly
        // exhausted inside pg-boss with no matching notification state.
        const isFinalAttempt = job.retryCount >= job.retryLimit;
        await db.notification.update({
          where: { id: notification.id },
          data: {
            attempts: { increment: 1 },
            lastError: `${result.status}: ${result.message}`,
            ...(isFinalAttempt ? { status: 'failed' as const } : {}),
          },
        });
        if (!isFinalAttempt) {
          return new Error(`Telegram send failed (${result.status}): ${result.message}`);
        }
        return;
      }
    }
  }
}
