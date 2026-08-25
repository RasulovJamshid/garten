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
    const notification = await this.prisma.notification.findFirst({
      where: { id: job.data.notificationId, tenantId: job.data.tenantId },
    });
    // Already handled by an earlier attempt (or the row was somehow
    // removed) — nothing to do, and definitely nothing to retry.
    if (!notification || notification.status !== 'queued') return;

    if (notification.channel === 'internal') {
      // "Internal" means it sits in the system for the admin to relay by
      // phone (§8.2) — there's nothing further to deliver.
      await this.prisma.notification.update({
        where: { id: notification.id },
        data: { status: 'sent', sentAt: new Date() },
      });
      return;
    }

    if (notification.channel !== 'telegram') {
      // sms/email have no provider wired in Stage 1 (05-telegram-spec.md
      // §1 — SMS requires a paid contract not yet in place).
      await this.prisma.notification.update({
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
      await this.prisma.notification.update({
        where: { id: notification.id },
        data: { status: 'skipped', lastError: 'recipient is not bound to Telegram' },
      });
      return;
    }

    if (activeBinding.blockedBot) {
      await this.prisma.notification.update({
        where: { id: notification.id },
        data: { status: 'failed', lastError: 'bot was previously blocked by this recipient' },
      });
      return;
    }

    const result = await this.telegram.sendMessage(activeBinding.chatId, notification.renderedBody);

    if (result.ok) {
      await this.prisma.notification.update({
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
        await this.prisma.notification.update({
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
        await this.prisma.notification.update({
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
        await this.prisma.notification.update({
          where: { id: notification.id },
          data: {
            attempts: { increment: 1 },
            lastError: `${result.status}: ${result.message}`,
            ...(isFinalAttempt ? { status: 'failed' as const } : {}),
          },
        });
        if (!isFinalAttempt) {
          throw new Error(`Telegram send failed (${result.status}): ${result.message}`);
        }
        return;
      }
    }
  }
}
