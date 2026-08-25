import { Injectable } from '@nestjs/common';
import { TenantPrisma } from '../prisma/tenant-prisma.provider';
import { AuditService } from '../audit/audit.service';
import { AuthContext } from '../common/auth-context';
import { AppErrors } from '../common/exceptions/app.exception';
import { UpsertNotificationTemplateDto } from './dto/notification-template.dto';
import { renderTemplate, validateTemplateVariables } from './template-render';

@Injectable()
export class NotificationTemplatesService {
  constructor(
    private readonly tenantPrisma: TenantPrisma,
    private readonly audit: AuditService,
  ) {}

  list() {
    return this.tenantPrisma.db.notificationTemplate.findMany({ orderBy: { templateKey: 'asc' } });
  }

  async get(templateKey: string) {
    const template = await this.tenantPrisma.db.notificationTemplate.findFirst({
      where: { templateKey },
    });
    if (!template) throw AppErrors.notFound('Notification template not found');
    return template;
  }

  async upsert(ctx: AuthContext, templateKey: string, dto: UpsertNotificationTemplateDto) {
    try {
      validateTemplateVariables(dto.bodyUz, dto.bodyRu, dto.variables);
    } catch (e) {
      throw AppErrors.validationFailed((e as Error).message);
    }

    const before = await this.tenantPrisma.db.notificationTemplate.findFirst({
      where: { templateKey },
    });

    const saved = await this.tenantPrisma.db.notificationTemplate.upsert({
      where: { tenantId_templateKey: { tenantId: this.tenantPrisma.tenantId, templateKey } },
      create: {
        tenantId: this.tenantPrisma.tenantId,
        templateKey,
        bodyUz: dto.bodyUz,
        bodyRu: dto.bodyRu,
        variables: dto.variables,
        enabled: dto.enabled ?? true,
        includeAmounts: dto.includeAmounts ?? true,
        updatedBy: ctx.userId,
      },
      update: {
        bodyUz: dto.bodyUz,
        bodyRu: dto.bodyRu,
        variables: dto.variables,
        enabled: dto.enabled ?? true,
        includeAmounts: dto.includeAmounts ?? true,
        updatedBy: ctx.userId,
      },
    });

    await this.audit.log({
      userId: ctx.userId,
      action: 'notification_template.update',
      entityType: 'notification_template',
      entityId: saved.id,
      oldValue: before ? { bodyUz: before.bodyUz, bodyRu: before.bodyRu } : undefined,
      newValue: { bodyUz: saved.bodyUz, bodyRu: saved.bodyRu },
    });

    return saved;
  }

  async preview(templateKey: string, sampleData: Record<string, string>) {
    const template = await this.get(templateKey);
    try {
      return {
        uz: renderTemplate(template.bodyUz, sampleData),
        ru: renderTemplate(template.bodyRu, sampleData),
      };
    } catch (e) {
      throw AppErrors.validationFailed((e as Error).message);
    }
  }
}
