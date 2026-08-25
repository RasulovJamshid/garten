import { Injectable } from '@nestjs/common';
import { TenantPrisma } from '../prisma/tenant-prisma.provider';
import { AuditService } from '../audit/audit.service';
import { AuthContext } from '../common/auth-context';
import { AppErrors } from '../common/exceptions/app.exception';
import { NotificationsService } from './notifications.service';
import { CreateAnnouncementDto } from './dto/announcement.dto';

const ANNOUNCEMENT_TEMPLATE_KEY = 'announcement';

@Injectable()
export class AnnouncementsService {
  constructor(
    private readonly tenantPrisma: TenantPrisma,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  list(filters: { branchId?: string }) {
    return this.tenantPrisma.db.announcement.findMany({
      where: { branchId: filters.branchId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
    });
  }

  async get(id: string) {
    const announcement = await this.tenantPrisma.db.announcement.findFirst({
      where: { id, deletedAt: null },
    });
    if (!announcement) throw AppErrors.notFound('Announcement not found');
    return announcement;
  }

  async create(ctx: AuthContext, dto: CreateAnnouncementDto) {
    const announcement = await this.tenantPrisma.db.announcement.create({
      data: {
        tenantId: this.tenantPrisma.tenantId,
        branchId: dto.branchId,
        title: dto.title,
        body: dto.body,
        priority: dto.priority ?? 'normal',
        audienceType: dto.audienceType,
        audienceIds: dto.audienceIds ?? [],
        fileIds: dto.fileIds ?? [],
        publishAt: dto.publishAt ? new Date(dto.publishAt) : undefined,
        expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : undefined,
        createdBy: ctx.userId,
      },
    });
    await this.audit.log({
      userId: ctx.userId,
      action: 'announcement.create',
      entityType: 'announcement',
      entityId: announcement.id,
      newValue: { title: announcement.title, audienceType: announcement.audienceType },
    });
    return announcement;
  }

  async remove(ctx: AuthContext, id: string) {
    const announcement = await this.get(id);
    await this.tenantPrisma.db.announcement.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
    await this.audit.log({
      userId: ctx.userId,
      action: 'announcement.create',
      entityType: 'announcement',
      entityId: announcement.id,
      newValue: { deleted: true },
    });
  }

  /**
   * Resolves the audience to a recipient list and fans out one
   * notification row (+ pg-boss job) per recipient, exactly like
   * `POST /notifications/send` — dedup_key keys off `announcementId` as
   * the entity, so re-publishing (or a retried request) never double-sends.
   */
  async publish(ctx: AuthContext, id: string) {
    const announcement = await this.get(id);
    if (announcement.publishedAt) {
      throw AppErrors.conflict('Announcement already published');
    }

    const guardianIds = await this.resolveGuardianAudience(announcement);
    const rendered = `${announcement.title}\n\n${announcement.body}`;

    let queued = 0;
    for (const guardianId of guardianIds) {
      const binding = await this.tenantPrisma.db.telegramBinding.findFirst({
        where: { guardianId, unboundAt: null },
        select: { language: true },
      });
      const guardian = binding
        ? null
        : await this.tenantPrisma.db.guardian.findFirst({
            where: { id: guardianId },
            select: { preferredLanguage: true },
          });
      const language = binding?.language ?? guardian?.preferredLanguage ?? 'ru';

      await this.notifications.enqueueDeduped({
        templateKey: ANNOUNCEMENT_TEMPLATE_KEY,
        announcementId: announcement.id,
        recipientGuardianId: guardianId,
        channel: 'telegram',
        language,
        renderedBody: rendered,
        payload: { title: announcement.title },
        dedupKey: NotificationsService.computeDedupKey(
          ANNOUNCEMENT_TEMPLATE_KEY,
          guardianId,
          announcement.id,
        ),
      });
      queued++;
    }

    const updated = await this.tenantPrisma.db.announcement.update({
      where: { id },
      data: { publishedAt: new Date() },
    });

    await this.audit.log({
      userId: ctx.userId,
      action: 'announcement.publish',
      entityType: 'announcement',
      entityId: id,
      newValue: { audienceType: announcement.audienceType, recipients: queued },
    });

    return { announcement: updated, queued };
  }

  private async resolveGuardianAudience(announcement: {
    branchId: string | null;
    audienceType: string;
    audienceIds: string[];
  }): Promise<string[]> {
    switch (announcement.audienceType) {
      case 'guardians':
        return announcement.audienceIds;

      case 'children': {
        const links = await this.tenantPrisma.db.childGuardian.findMany({
          where: { childId: { in: announcement.audienceIds } },
          select: { guardianId: true },
        });
        return [...new Set(links.map((l) => l.guardianId))];
      }

      case 'group': {
        const assignments = await this.tenantPrisma.db.groupAssignment.findMany({
          where: { groupId: { in: announcement.audienceIds }, effectiveTo: null },
          select: { childId: true },
        });
        const links = await this.tenantPrisma.db.childGuardian.findMany({
          where: { childId: { in: assignments.map((a) => a.childId) } },
          select: { guardianId: true },
        });
        return [...new Set(links.map((l) => l.guardianId))];
      }

      case 'staff':
        // Staff are app_user recipients, not guardians — not fanned out
        // here (no channel implemented for internal staff push in Stage
        // 1 beyond Telegram binding by guardian_id).
        return [];

      case 'all':
      default: {
        const children = await this.tenantPrisma.db.child.findMany({
          where: { branchId: announcement.branchId ?? undefined, status: 'active' },
          select: { id: true },
        });
        const links = await this.tenantPrisma.db.childGuardian.findMany({
          where: { childId: { in: children.map((c) => c.id) } },
          select: { guardianId: true },
        });
        return [...new Set(links.map((l) => l.guardianId))];
      }
    }
  }
}
