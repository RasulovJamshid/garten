import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { TenantPrisma } from '../prisma/tenant-prisma.provider';
import { AppErrors } from '../common/exceptions/app.exception';
import { PgBossService } from '../jobs/pgboss.service';
import { SendNotificationDto } from './dto/send-notification.dto';
import { renderTemplate } from './template-render';

export const NOTIFICATION_SEND_QUEUE = 'notification.send';

export interface NotificationJobData {
  notificationId: string;
  tenantId: string;
}

/**
 * dedup_key = sha256(templateKey + recipientId + entityId), enforced by a
 * unique index in Postgres (uq_notification_dedup) — a retried request, a
 * double-clicked button, or a replayed offline check-in all collapse to
 * one row (05-telegram-spec.md §4). This is also what makes
 * `POST /notifications/send` safe to retry without a persisted
 * Idempotency-Key ledger: the content-addressed key already guarantees
 * exactly one notification per (template, recipient, entity) tuple, a
 * stronger guarantee than comparing a client-supplied header would give.
 */
function dedupKey(templateKey: string, recipientId: string, entityId: string): string {
  return createHash('sha256').update(`${templateKey}:${recipientId}:${entityId}`).digest('hex');
}

@Injectable()
export class NotificationsService {
  constructor(
    private readonly tenantPrisma: TenantPrisma,
    private readonly boss: PgBossService,
  ) {}

  /** telegram_binding.language -> guardian.preferred_language -> setting.default_language (§5). */
  private async resolveLanguage(recipient: {
    guardianId?: string;
    userId?: string;
  }): Promise<string> {
    if (recipient.guardianId) {
      const binding = await this.tenantPrisma.db.telegramBinding.findFirst({
        where: { guardianId: recipient.guardianId, unboundAt: null },
        select: { language: true },
      });
      if (binding) return binding.language;
      const guardian = await this.tenantPrisma.db.guardian.findFirst({
        where: { id: recipient.guardianId },
        select: { preferredLanguage: true },
      });
      if (guardian) return guardian.preferredLanguage;
    } else if (recipient.userId) {
      const binding = await this.tenantPrisma.db.telegramBinding.findFirst({
        where: { userId: recipient.userId, unboundAt: null },
        select: { language: true },
      });
      if (binding) return binding.language;
      const user = await this.tenantPrisma.db.appUser.findFirst({
        where: { id: recipient.userId },
        select: { language: true },
      });
      if (user) return user.language;
    }
    const setting = await this.tenantPrisma.db.setting.findUnique({
      where: { tenantId: this.tenantPrisma.tenantId },
      select: { defaultLanguage: true },
    });
    return setting?.defaultLanguage ?? 'ru';
  }

  /**
   * Queues one notification row per recipient and hands each to pg-boss.
   * Never sends inline — the caller (an API request or an event hook)
   * must not block on Telegram's API (§4 "Never send inside the request
   * that triggered it").
   */
  async send(dto: SendNotificationDto) {
    const template = await this.tenantPrisma.db.notificationTemplate.findFirst({
      where: { templateKey: dto.templateKey },
    });
    if (!template) throw AppErrors.notFound(`Unknown template key "${dto.templateKey}"`);
    if (!template.enabled) throw AppErrors.conflict(`Template "${dto.templateKey}" is disabled`);

    const results: {
      recipient: (typeof dto.recipients)[number];
      notificationId?: string;
      skipped?: string;
    }[] = [];

    for (const recipient of dto.recipients) {
      const recipientKey = recipient.guardianId ?? recipient.userId;
      if (!recipientKey) {
        results.push({ recipient, skipped: 'Recipient must have guardianId or userId' });
        continue;
      }

      const language = await this.resolveLanguage(recipient);

      let rendered: string;
      if (!template.includeAmounts) {
        // §5 privacy default: some clients consider amounts sensitive in a
        // chat anyone can read over a shoulder — swap the whole message
        // for a generic office-contact prompt rather than rendering the
        // template with the amount blanked out mid-sentence.
        rendered =
          language === 'uz'
            ? 'Sizda yangi bildirishnoma bor, iltimos ofis bilan bog‘laning.'
            : 'У вас новое уведомление, пожалуйста, свяжитесь с офисом.';
      } else {
        const body = language === 'uz' ? template.bodyUz : template.bodyRu;
        try {
          rendered = renderTemplate(body, dto.data);
        } catch (e) {
          results.push({ recipient, skipped: (e as Error).message });
          continue;
        }
      }

      const entityId = dto.entityId ?? 'manual';
      const key = dedupKey(dto.templateKey, recipientKey, entityId);
      const notificationId = await this.enqueueDeduped({
        templateKey: dto.templateKey,
        recipientGuardianId: recipient.guardianId,
        recipientUserId: recipient.userId,
        channel: dto.channel,
        language,
        renderedBody: rendered,
        payload: dto.data,
        dedupKey: key,
      });

      results.push({ recipient, notificationId });
    }

    return { queued: results.filter((r) => r.notificationId).length, results };
  }

  /**
   * uq_notification_dedup is a *partial* unique index
   * (`WHERE dedup_key IS NOT NULL`) — Prisma's schema DSL can't represent
   * that as a `@@unique` usable by `upsert()`, so the ON CONFLICT DO
   * NOTHING semantics that make this call idempotent have to be raw SQL.
   * `DO UPDATE SET dedup_key = EXCLUDED.dedup_key` is a no-op write, used
   * only so `RETURNING id` still gives back the existing row's id on a
   * duplicate (a real DO NOTHING returns no row at all).
   *
   * Public because AnnouncementsService's fan-out needs the same
   * dedup+enqueue primitive (one row per recipient, same job queue) —
   * rather than duplicate it, it calls straight into this.
   */
  async enqueueDeduped(row: {
    templateKey: string | null;
    announcementId?: string;
    recipientGuardianId?: string;
    recipientUserId?: string;
    channel: string;
    language: string;
    renderedBody: string;
    payload: Record<string, string>;
    dedupKey: string;
  }): Promise<string> {
    const rows = await this.tenantPrisma.db.$queryRaw<{ id: string }[]>`
      INSERT INTO notification (
        id, tenant_id, template_key, announcement_id, recipient_guardian_id, recipient_user_id,
        channel, language, rendered_body, payload, dedup_key, status
      ) VALUES (
        gen_random_uuid(), ${this.tenantPrisma.tenantId}::uuid, ${row.templateKey},
        ${row.announcementId ?? null}::uuid,
        ${row.recipientGuardianId ?? null}::uuid, ${row.recipientUserId ?? null}::uuid,
        ${row.channel}, ${row.language}, ${row.renderedBody},
        ${JSON.stringify(row.payload)}::jsonb, ${row.dedupKey}, 'queued'
      )
      ON CONFLICT (tenant_id, dedup_key) WHERE dedup_key IS NOT NULL
      DO UPDATE SET dedup_key = EXCLUDED.dedup_key
      RETURNING id
    `;
    const notificationId = rows[0].id;
    await this.boss.send(
      NOTIFICATION_SEND_QUEUE,
      { notificationId, tenantId: this.tenantPrisma.tenantId } as NotificationJobData,
      { retryLimit: 3, retryBackoff: true, retryDelay: 2 },
    );
    return notificationId;
  }

  /** Exposed for AnnouncementsService, which computes its own dedup key. */
  static computeDedupKey(templateKey: string, recipientId: string, entityId: string): string {
    return dedupKey(templateKey, recipientId, entityId);
  }

  list(filters: {
    recipientId?: string;
    channel?: string;
    status?: string;
    from?: string;
    to?: string;
  }) {
    return this.tenantPrisma.db.notification.findMany({
      where: {
        recipientGuardianId: filters.recipientId,
        channel: filters.channel,
        status: filters.status,
        queuedAt: {
          gte: filters.from ? new Date(filters.from) : undefined,
          lte: filters.to ? new Date(filters.to) : undefined,
        },
      },
      orderBy: { queuedAt: 'desc' },
      take: 500,
    });
  }

  async get(id: string) {
    const notification = await this.tenantPrisma.db.notification.findFirst({ where: { id } });
    if (!notification) throw AppErrors.notFound('Notification not found');
    return notification;
  }

  async retry(id: string) {
    const notification = await this.get(id);
    if (notification.status !== 'failed') {
      throw AppErrors.conflict('Only a failed notification can be retried');
    }
    const updated = await this.tenantPrisma.db.notification.update({
      where: { id },
      data: { status: 'queued', lastError: null },
    });
    await this.boss.send(
      NOTIFICATION_SEND_QUEUE,
      { notificationId: id, tenantId: this.tenantPrisma.tenantId } as NotificationJobData,
      { retryLimit: 3, retryBackoff: true, retryDelay: 2 },
    );
    return updated;
  }
}
