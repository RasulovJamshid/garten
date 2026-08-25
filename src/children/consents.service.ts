import { Injectable } from '@nestjs/common';
import { TenantPrisma } from '../prisma/tenant-prisma.provider';
import { AuditService } from '../audit/audit.service';
import { AppErrors } from '../common/exceptions/app.exception';
import { AuthContext } from '../common/auth-context';
import { RecordConsentDto } from './dto/consent.dto';

@Injectable()
export class ConsentsService {
  constructor(
    private readonly tenantPrisma: TenantPrisma,
    private readonly audit: AuditService,
  ) {}

  list(childId: string) {
    return this.tenantPrisma.db.consent.findMany({
      where: { childId },
      orderBy: { grantedAt: 'desc' },
    });
  }

  /**
   * `uq_consent` is a partial unique index on (child_id, guardian_id,
   * consent_type) WHERE revoked_at IS NULL — at most one *active* consent
   * record per (child, guardian, type). Recording the same combination
   * again updates that row in place (a guardian changing their mind)
   * rather than creating a second active row, which the index would
   * reject anyway.
   */
  async record(ctx: AuthContext, childId: string, dto: RecordConsentDto) {
    const child = await this.tenantPrisma.db.child.findUnique({ where: { id: childId } });
    if (!child) throw AppErrors.notFound('Child not found');

    const existing = await this.tenantPrisma.db.consent.findFirst({
      where: {
        childId,
        guardianId: dto.guardianId,
        consentType: dto.consentType,
        revokedAt: null,
      },
    });

    const record = existing
      ? await this.tenantPrisma.db.consent.update({
          where: { id: existing.id },
          data: {
            granted: dto.granted,
            grantedAt: new Date(),
            evidenceFileId: dto.evidenceFileId,
          },
        })
      : await this.tenantPrisma.db.consent.create({
          data: {
            tenantId: this.tenantPrisma.tenantId,
            childId,
            guardianId: dto.guardianId,
            consentType: dto.consentType,
            granted: dto.granted,
            evidenceFileId: dto.evidenceFileId,
          },
        });

    await this.audit.log({
      userId: ctx.userId,
      action: 'consent.record',
      entityType: 'consent',
      entityId: record.id,
      oldValue: existing ? { granted: existing.granted } : undefined,
      newValue: {
        childId,
        guardianId: dto.guardianId,
        consentType: dto.consentType,
        granted: dto.granted,
      },
    });

    return record;
  }

  async revoke(ctx: AuthContext, childId: string, id: string) {
    const consent = await this.tenantPrisma.db.consent.findFirst({ where: { id, childId } });
    if (!consent) throw AppErrors.notFound('Consent record not found');
    if (consent.revokedAt) throw AppErrors.conflict('Consent already revoked');

    const updated = await this.tenantPrisma.db.consent.update({
      where: { id },
      data: { revokedAt: new Date() },
    });

    await this.audit.log({
      userId: ctx.userId,
      action: 'consent.revoke',
      entityType: 'consent',
      entityId: id,
      newValue: { revoked: true },
    });

    return updated;
  }
}
