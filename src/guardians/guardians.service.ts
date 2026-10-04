import { Injectable } from '@nestjs/common';
import { TenantPrisma } from '../prisma/tenant-prisma.provider';
import { AuditService } from '../audit/audit.service';
import { AppErrors } from '../common/exceptions/app.exception';
import { AuthContext } from '../common/auth-context';
import { normalizePhone } from '../common/phone';
import { CreateGuardianDto } from './dto/create-guardian.dto';
import { UpdateGuardianDto } from './dto/update-guardian.dto';
import { LinkGuardianDto, UpdateGuardianLinkDto } from './dto/link-guardian.dto';

@Injectable()
export class GuardiansService {
  constructor(
    private readonly tenantPrisma: TenantPrisma,
    private readonly audit: AuditService,
  ) {}

  private scope(permission: string) {
    const ctx = this.tenantPrisma.context;
    if (ctx.scopeFor(permission) === 'all') return {};
    return {
      OR: [
        { createdBy: ctx.userId },
        { childGuardian: { some: { child: this.tenantPrisma.childWhere(permission) } } },
      ],
    };
  }

  list(filters: { q?: string; phone?: string }) {
    const where: Record<string, unknown> = { deletedAt: null };
    if (filters.phone) where.phone = normalizePhone(filters.phone);
    if (filters.q) {
      where.OR = [
        { fullName: { contains: filters.q, mode: 'insensitive' } },
        { phone: { contains: filters.q } },
      ];
    }
    return this.tenantPrisma.db.guardian.findMany({
      where: { AND: [where, this.scope('guardian:read')] },
      orderBy: { fullName: 'asc' },
    });
  }

  async findOneOrThrow(id: string, permission = 'guardian:read') {
    const guardian = await this.tenantPrisma.db.guardian.findFirst({
      where: { AND: [{ id, deletedAt: null }, this.scope(permission)] },
    });
    if (!guardian) throw AppErrors.notFound('Guardian not found');
    return guardian;
  }

  /**
   * Deduplicated by (tenantId, phone) — an existing phone returns 409
   * DUPLICATE plus the existing record so the client links instead of
   * creating a second parent row for the same person (api-spec §5).
   */
  async create(ctx: AuthContext, dto: CreateGuardianDto) {
    const phone = normalizePhone(dto.phone);
    const existing = await this.tenantPrisma.db.guardian.findFirst({ where: { phone } });
    if (existing) {
      const visible = await this.tenantPrisma.db.guardian.findFirst({
        where: { AND: [{ id: existing.id }, this.scope('guardian:manage')] },
      });
      throw AppErrors.duplicate('A guardian with this phone already exists', visible ?? undefined);
    }

    const guardian = await this.tenantPrisma.db.guardian.create({
      data: {
        tenantId: this.tenantPrisma.tenantId,
        fullName: dto.fullName,
        phone,
        phoneAlt: dto.phoneAlt,
        email: dto.email,
        address: dto.address,
        workplace: dto.workplace,
        passportNumber: dto.passportNumber,
        preferredLanguage: dto.preferredLanguage,
        createdBy: ctx.userId,
      },
    });

    await this.audit.log({
      userId: ctx.userId,
      action: 'child.update', // guardian creation isn't in the ops-reference action list separately
      entityType: 'guardian',
      entityId: guardian.id,
      newValue: { fullName: guardian.fullName, phone: guardian.phone },
    });

    return guardian;
  }

  async update(ctx: AuthContext, id: string, dto: UpdateGuardianDto) {
    const before = await this.findOneOrThrow(id, 'guardian:manage');
    const phone = dto.phone ? normalizePhone(dto.phone) : undefined;

    if (phone && phone !== before.phone) {
      const clash = await this.tenantPrisma.db.guardian.findFirst({
        where: { phone, id: { not: id } },
      });
      if (clash) throw AppErrors.duplicate('Another guardian already uses this phone');
    }

    const updated = await this.tenantPrisma.db.guardian.update({
      where: { id },
      data: { ...dto, phone },
    });

    await this.audit.log({
      userId: ctx.userId,
      action: 'child.update',
      entityType: 'guardian',
      entityId: id,
      oldValue: { fullName: before.fullName, phone: before.phone },
      newValue: { fullName: updated.fullName, phone: updated.phone },
    });

    return updated;
  }

  async childrenOf(id: string) {
    await this.findOneOrThrow(id);
    return this.tenantPrisma.db.childGuardian.findMany({
      where: { guardianId: id, child: this.tenantPrisma.childWhere('guardian:read') },
      include: { child: { select: { id: true, firstName: true, lastName: true, status: true } } },
    });
  }

  async guardiansOfChild(childId: string, permission = 'child:read') {
    await this.tenantPrisma.assertChild(childId, permission);
    return this.tenantPrisma.db.childGuardian.findMany({
      where: { childId },
      include: { guardian: true },
    });
  }

  async link(ctx: AuthContext, childId: string, dto: LinkGuardianDto) {
    await this.tenantPrisma.assertChild(childId, 'guardian:manage');
    await this.findOneOrThrow(dto.guardianId, 'guardian:manage');

    await this.tenantPrisma.db.$transaction(async (tx) => {
      if (dto.isPrimaryContact) {
        await tx.childGuardian.updateMany({
          where: { childId },
          data: { isPrimaryContact: false },
        });
      }
      await tx.childGuardian.upsert({
        where: { childId_guardianId: { childId, guardianId: dto.guardianId } },
        create: {
          tenantId: this.tenantPrisma.tenantId,
          childId,
          guardianId: dto.guardianId,
          relationship: dto.relationship,
          isPayer: dto.isPayer ?? false,
          isEmergencyContact: dto.isEmergencyContact ?? false,
          isPrimaryContact: dto.isPrimaryContact ?? false,
        },
        update: {
          relationship: dto.relationship,
          isPayer: dto.isPayer ?? false,
          isEmergencyContact: dto.isEmergencyContact ?? false,
          isPrimaryContact: dto.isPrimaryContact ?? false,
        },
      });
    });

    await this.audit.log({
      userId: ctx.userId,
      action: 'child.update',
      entityType: 'child_guardian',
      entityId: childId,
      newValue: { guardianId: dto.guardianId, relationship: dto.relationship },
    });

    return this.guardiansOfChild(childId, 'guardian:manage');
  }

  async updateLink(
    ctx: AuthContext,
    childId: string,
    guardianId: string,
    dto: UpdateGuardianLinkDto,
  ) {
    await this.tenantPrisma.assertChild(childId, 'guardian:manage');
    const link = await this.tenantPrisma.db.childGuardian.findUnique({
      where: { childId_guardianId: { childId, guardianId } },
    });
    if (!link) throw AppErrors.notFound('Guardian is not linked to this child');

    await this.tenantPrisma.db.$transaction(async (tx) => {
      if (dto.isPrimaryContact) {
        await tx.childGuardian.updateMany({
          where: { childId },
          data: { isPrimaryContact: false },
        });
      }
      await tx.childGuardian.update({
        where: { childId_guardianId: { childId, guardianId } },
        data: dto,
      });
    });

    await this.audit.log({
      userId: ctx.userId,
      action: 'child.update',
      entityType: 'child_guardian',
      entityId: childId,
      newValue: { guardianId, ...dto },
    });

    return this.guardiansOfChild(childId, 'guardian:manage');
  }

  async unlink(ctx: AuthContext, childId: string, guardianId: string) {
    await this.tenantPrisma.assertChild(childId, 'guardian:manage');
    const link = await this.tenantPrisma.db.childGuardian.findUnique({
      where: { childId_guardianId: { childId, guardianId } },
    });
    if (!link) throw AppErrors.notFound('Guardian is not linked to this child');

    await this.tenantPrisma.db.childGuardian.delete({
      where: { childId_guardianId: { childId, guardianId } },
    });

    await this.audit.log({
      userId: ctx.userId,
      action: 'child.update',
      entityType: 'child_guardian',
      entityId: childId,
      oldValue: { guardianId },
    });
  }
}
