import { Injectable } from '@nestjs/common';
import { TenantPrisma } from '../prisma/tenant-prisma.provider';
import { AuditService } from '../audit/audit.service';
import { AppErrors } from '../common/exceptions/app.exception';
import { AuthContext } from '../common/auth-context';
import { CreateChildDto } from './dto/create-child.dto';
import { UpdateChildDto } from './dto/update-child.dto';
import { ChildStatusDto } from './dto/child-status.dto';

export interface ChildListFilters {
  status?: string;
  groupId?: string;
  q?: string;
  page: number;
  limit: number;
}

const CHILD_LIST_SELECT = {
  id: true,
  branchId: true,
  firstName: true,
  lastName: true,
  middleName: true,
  birthDate: true,
  status: true,
  photoFileId: true,
} as const;

@Injectable()
export class ChildrenService {
  constructor(
    private readonly tenantPrisma: TenantPrisma,
    private readonly audit: AuditService,
  ) {}

  /**
   * `child` has no direct groupId column — group membership lives in
   * group_assignment (current = effectiveTo IS NULL), so own_group scoping
   * is a relation filter rather than the generic ScopeService's flat
   * `{ field: { in } }` pattern (scope.service.ts documents this trade-off).
   */
  private scopedWhere(ctx: AuthContext): Record<string, unknown> {
    const scope = ctx.scopeFor('child:read');
    if (!scope) throw AppErrors.forbidden("Missing permission: 'child:read'");

    switch (scope) {
      case 'all':
        return {};
      case 'branch':
        return { branchId: { in: ctx.branchIds } };
      case 'own_group':
        return {
          groupAssignment: { some: { groupId: { in: ctx.ownGroupIds }, effectiveTo: null } },
        };
      default:
        throw AppErrors.invalidScope(`Unsupported scope '${scope}' for child:read`);
    }
  }

  async list(ctx: AuthContext, filters: ChildListFilters) {
    const where: Record<string, unknown> = { ...this.scopedWhere(ctx), deletedAt: null };
    if (filters.status) where.status = filters.status;
    if (filters.groupId) {
      where.groupAssignment = { some: { groupId: filters.groupId, effectiveTo: null } };
    }
    if (filters.q) {
      where.OR = [
        { firstName: { contains: filters.q, mode: 'insensitive' } },
        { lastName: { contains: filters.q, mode: 'insensitive' } },
      ];
    }

    const take = Math.min(filters.limit, 200);
    const skip = (filters.page - 1) * take;

    const [data, total] = await Promise.all([
      this.tenantPrisma.db.child.findMany({
        where,
        select: CHILD_LIST_SELECT,
        orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
        take,
        skip,
      }),
      this.tenantPrisma.db.child.count({ where }),
    ]);

    return {
      data,
      meta: { page: filters.page, limit: take, total, pages: Math.ceil(total / take) },
    };
  }

  async findOneOrThrow(ctx: AuthContext, id: string) {
    const child = await this.tenantPrisma.db.child.findFirst({
      where: { id, ...this.scopedWhere(ctx), deletedAt: null },
      include: {
        childGuardian: {
          include: {
            guardian: {
              select: { id: true, fullName: true, phone: true, preferredLanguage: true },
            },
          },
        },
        allergy: {
          where: { deletedAt: null },
          select: { allergen: true, severity: true, instruction: true },
        },
      },
    });
    if (!child) throw AppErrors.notFound('Child not found');
    return child;
  }

  async create(ctx: AuthContext, dto: CreateChildDto) {
    const child = await this.tenantPrisma.db.child.create({
      data: {
        tenantId: this.tenantPrisma.tenantId,
        branchId: dto.branchId,
        firstName: dto.firstName,
        lastName: dto.lastName,
        middleName: dto.middleName,
        birthDate: new Date(dto.birthDate),
        gender: dto.gender,
        address: dto.address,
        enrollmentDate: dto.enrollmentDate ? new Date(dto.enrollmentDate) : null,
        contractNumber: dto.contractNumber,
        registrationNumber: dto.registrationNumber,
        note: dto.note,
        createdBy: ctx.userId,
      },
    });

    await this.audit.log({
      userId: ctx.userId,
      action: 'child.create',
      entityType: 'child',
      entityId: child.id,
      newValue: { firstName: child.firstName, lastName: child.lastName },
    });

    return child;
  }

  async update(ctx: AuthContext, id: string, dto: UpdateChildDto) {
    const before = await this.findOneOrThrow(ctx, id);

    const updated = await this.tenantPrisma.db.child.update({
      where: { id },
      data: {
        branchId: dto.branchId,
        firstName: dto.firstName,
        lastName: dto.lastName,
        middleName: dto.middleName,
        birthDate: dto.birthDate ? new Date(dto.birthDate) : undefined,
        gender: dto.gender,
        address: dto.address,
        enrollmentDate: dto.enrollmentDate ? new Date(dto.enrollmentDate) : undefined,
        contractNumber: dto.contractNumber,
        registrationNumber: dto.registrationNumber,
        note: dto.note,
        photoFileId: dto.photoFileId,
        updatedBy: ctx.userId,
      },
    });

    await this.audit.log({
      userId: ctx.userId,
      action: 'child.update',
      entityType: 'child',
      entityId: id,
      oldValue: { firstName: before.firstName, lastName: before.lastName, status: before.status },
      newValue: {
        firstName: updated.firstName,
        lastName: updated.lastName,
        status: updated.status,
      },
    });

    return updated;
  }

  async setStatus(ctx: AuthContext, id: string, dto: ChildStatusDto) {
    const child = await this.findOneOrThrow(ctx, id);

    await this.tenantPrisma.db.$transaction([
      this.tenantPrisma.db.child.update({
        where: { id },
        data: {
          status: dto.status,
          updatedBy: ctx.userId,
          withdrawalDate:
            dto.status === 'withdrawn' || dto.status === 'graduated'
              ? new Date(dto.effectiveDate)
              : undefined,
        },
      }),
      this.tenantPrisma.db.childStatusHistory.create({
        data: {
          tenantId: this.tenantPrisma.tenantId,
          childId: id,
          oldStatus: child.status,
          newStatus: dto.status,
          effectiveDate: new Date(dto.effectiveDate),
          reason: dto.reason,
          changedBy: ctx.userId,
        },
      }),
    ]);

    await this.audit.log({
      userId: ctx.userId,
      action: 'child.status_change',
      entityType: 'child',
      entityId: id,
      oldValue: { status: child.status },
      newValue: { status: dto.status, reason: dto.reason },
    });

    return this.findOneOrThrow(ctx, id);
  }

  async history(ctx: AuthContext, id: string) {
    await this.findOneOrThrow(ctx, id);
    return this.tenantPrisma.db.childStatusHistory.findMany({
      where: { childId: id },
      orderBy: { effectiveDate: 'desc' },
    });
  }

  async remove(ctx: AuthContext, id: string) {
    await this.findOneOrThrow(ctx, id);
    await this.tenantPrisma.db.child.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.audit.log({
      userId: ctx.userId,
      action: 'child.delete',
      entityType: 'child',
      entityId: id,
    });
  }
}
