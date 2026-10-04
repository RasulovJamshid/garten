import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { TenantPrisma } from '../prisma/tenant-prisma.provider';
import { AuditService } from '../audit/audit.service';
import { AppErrors } from '../common/exceptions/app.exception';
import { AuthContext } from '../common/auth-context';
import { andWhere } from '../common/prisma-where';
import { CreateChildDto } from './dto/create-child.dto';
import { UpdateChildDto } from './dto/update-child.dto';
import { ChildStatusDto } from './dto/child-status.dto';
import { effectiveOn, todayInTashkent } from '../common/tashkent-date';

export interface ChildListFilters {
  status?: string;
  groupId?: string;
  branchId?: string;
  q?: string;
  hasDebt?: boolean;
  hasMedicalAlert?: boolean;
  sort?: string;
  page: number;
  limit: number;
}

/**
 * The row shape the children directory renders. `groupAssignment` is
 * included (not just filtered on) so the table can show a group column
 * without an N+1 — `child` has no groupId of its own.
 */
const CHILD_LIST_SELECT = () =>
  ({
    id: true,
    branchId: true,
    firstName: true,
    lastName: true,
    middleName: true,
    birthDate: true,
    gender: true,
    status: true,
    photoFileId: true,
    groupAssignment: {
      where: effectiveOn(),
      select: { groupId: true, childGroup: { select: { id: true, name: true } } },
      take: 1,
    },
  }) as const;

/** Whitelist for `?sort=field:dir` — anything else is a 422, never silently ignored. */
const SORTABLE_FIELDS = ['lastName', 'firstName', 'birthDate', 'status', 'createdAt'] as const;

const DEFAULT_ORDER: Prisma.ChildOrderByWithRelationInput[] = [
  { lastName: 'asc' },
  { firstName: 'asc' },
];

function parseSort(sort?: string): Prisma.ChildOrderByWithRelationInput[] {
  if (!sort) return DEFAULT_ORDER;
  const [field, dir = 'asc'] = sort.split(':');
  if (!(SORTABLE_FIELDS as readonly string[]).includes(field) || !['asc', 'desc'].includes(dir)) {
    throw AppErrors.validationFailed({
      sort: `Expected '<field>:asc|desc' where field is one of ${SORTABLE_FIELDS.join(', ')}`,
    });
  }
  return [{ [field]: dir as Prisma.SortOrder }];
}

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
  private scopedWhere(ctx: AuthContext, permission = 'child:read'): Record<string, unknown> {
    return this.tenantPrisma.childWhere(permission);
  }

  async list(ctx: AuthContext, filters: ChildListFilters) {
    // Every filter goes through andWhere, never `where.x =` — `groupId`
    // and the own_group scope both target `groupAssignment` (prisma-where.ts).
    let where: Record<string, unknown> = { deletedAt: null };
    where = andWhere(where, this.scopedWhere(ctx));

    if (filters.status) where = andWhere(where, { status: filters.status });
    if (filters.branchId) where = andWhere(where, { branchId: filters.branchId });
    if (filters.groupId) {
      where = andWhere(where, {
        groupAssignment: { some: { groupId: filters.groupId, ...effectiveOn() } },
      });
    }
    if (filters.hasMedicalAlert !== undefined) {
      if (!ctx.has('medical:alerts')) throw AppErrors.forbidden();
      where = andWhere(where, this.tenantPrisma.childWhere('medical:alerts'));
      const medicalAlert = {
        OR: [
          { allergy: { some: { deletedAt: null } } },
          { medicalRecord: { is: { emergencyInstructions: { not: '' } } } },
        ],
      };
      where = andWhere(where, filters.hasMedicalAlert ? medicalAlert : { NOT: medicalAlert });
    }
    if (filters.q) {
      const contains = { contains: filters.q, mode: 'insensitive' as const };
      where = andWhere(where, {
        OR: [{ firstName: contains }, { lastName: contains }, { middleName: contains }],
      });
    }

    if (filters.hasDebt !== undefined) {
      if (!ctx.has('debt:read')) throw AppErrors.forbidden();
      where = andWhere(where, this.tenantPrisma.childWhere('debt:read'));
      const inDebt = await this.childIdsInDebt();
      where = andWhere(where, { id: filters.hasDebt ? { in: inDebt } : { notIn: inDebt } });
    }

    const take = Math.min(filters.limit, 200);
    const skip = (filters.page - 1) * take;

    const [data, total] = await Promise.all([
      this.tenantPrisma.db.child.findMany({
        where,
        select: CHILD_LIST_SELECT(),
        orderBy: parseSort(filters.sort),
        take,
        skip,
      }),
      this.tenantPrisma.db.child.count({ where }),
    ]);

    const ids = data.map((c) => c.id);
    const medical = ctx.has('medical:alerts')
      ? await this.tenantPrisma.db.child.findMany({
          where: { AND: [{ id: { in: ids } }, this.tenantPrisma.childWhere('medical:alerts')] },
          select: {
            id: true,
            medicalRecord: { select: { emergencyInstructions: true } },
            _count: { select: { allergy: { where: { deletedAt: null } } } },
          },
        })
      : [];
    const alerts = new Map(
      medical.map((c) => [
        c.id,
        c._count.allergy > 0 || Boolean(c.medicalRecord?.emergencyInstructions),
      ]),
    );
    const debtChildren = ctx.has('debt:read')
      ? await this.tenantPrisma.db.child.findMany({
          where: { AND: [{ id: { in: ids } }, this.tenantPrisma.childWhere('debt:read')] },
          select: { id: true },
        })
      : [];
    const debtorIds = debtChildren.length
      ? new Set(await this.childIdsInDebt())
      : new Set<string>();
    const debtVisible = new Set(debtChildren.map((c) => c.id));
    return {
      data: data.map((c) => ({
        ...this.toListRow(c),
        hasMedicalAlert: alerts.get(c.id) ?? null,
        hasDebt: debtVisible.has(c.id) ? debtorIds.has(c.id) : null,
      })),
      meta: { page: filters.page, limit: take, total, pages: Math.ceil(total / take) },
    };
  }

  /**
   * Balance is derived, never stored (debts.service.ts) — there is no
   * `child.hasDebt` column to filter on, so `?hasDebt=` resolves to a set
   * of ids from v_child_balance first. Raw SQL bypasses the tenant Prisma
   * extension, hence the explicit tenant_id predicate.
   */
  private async childIdsInDebt(): Promise<string[]> {
    const rows = await this.tenantPrisma.db.$queryRaw<{ child_id: string }[]>`
      SELECT child_id FROM v_child_balance
      WHERE tenant_id = ${this.tenantPrisma.tenantId}::uuid AND debt_tiyin > 0
    `;
    return rows.map((r) => r.child_id);
  }

  /** Flattens the current group assignment onto the row the client reads. */
  private toListRow<
    T extends { groupAssignment: { groupId: string; childGroup: { id: string; name: string } }[] },
  >(c: T) {
    const { groupAssignment, ...rest } = c;
    const current = groupAssignment.at(0);
    return {
      ...rest,
      groupId: current?.groupId ?? null,
      groupName: current?.childGroup.name ?? null,
    };
  }

  async findOneOrThrow(ctx: AuthContext, id: string, permission = 'child:read') {
    const child = await this.tenantPrisma.db.child.findFirst({
      where: andWhere({ id, deletedAt: null }, this.scopedWhere(ctx, permission)),
      include: {
        childGuardian: {
          include: {
            guardian: {
              select: { id: true, fullName: true, phone: true, preferredLanguage: true },
            },
          },
        },
        allergy: {
          where: ctx.has('medical:alerts')
            ? { deletedAt: null, child: this.tenantPrisma.childWhere('medical:alerts') }
            : { id: { in: [] } },
          select: { allergen: true, severity: true, instruction: true },
        },
        groupAssignment: {
          where: effectiveOn(),
          select: { groupId: true, childGroup: { select: { id: true, name: true } } },
          take: 1,
        },
      },
    });
    if (!child) throw AppErrors.notFound('Child not found');
    // Same flattening as the list rows, so a profile header and a table
    // row read `groupId`/`groupName` the same way.
    return this.toListRow(child);
  }

  async create(ctx: AuthContext, dto: CreateChildDto) {
    await this.tenantPrisma.assertBranch(dto.branchId, 'child:create');
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
    return this.tenantPrisma.transaction(async () => {
      await this.tenantPrisma.db
        .$queryRaw`SELECT id FROM child WHERE id = ${id}::uuid AND tenant_id = ${ctx.tenantId}::uuid FOR UPDATE`;
      const before = await this.findOneOrThrow(ctx, id, 'child:update');
      if (dto.branchId) await this.tenantPrisma.assertBranch(dto.branchId, 'child:update');
      if (dto.branchId && dto.branchId !== before.branchId) {
        const on = new Date(todayInTashkent());
        const remaining = {
          childId: id,
          OR: [{ effectiveTo: null }, { effectiveTo: { gte: on } }],
        };
        const [group, tariff] = await Promise.all([
          this.tenantPrisma.db.groupAssignment.findFirst({
            where: { ...remaining, childGroup: { branchId: { not: dto.branchId } } },
          }),
          this.tenantPrisma.db.childTariff.findFirst({
            where: { ...remaining, tariff: { branchId: { not: dto.branchId } } },
          }),
        ]);
        if (group || tariff)
          throw AppErrors.conflict(
            'BRANCH_TRANSFER_ASSIGNMENTS: end incompatible group and tariff assignments before changing branch',
          );
      }

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
    });
  }

  async setStatus(ctx: AuthContext, id: string, dto: ChildStatusDto) {
    return this.tenantPrisma.transaction(async () => {
      await this.tenantPrisma.db
        .$queryRaw`SELECT id FROM child WHERE id = ${id}::uuid AND tenant_id = ${ctx.tenantId}::uuid FOR UPDATE`;
      const child = await this.findOneOrThrow(ctx, id, 'child:status');
      if (dto.effectiveDate.slice(0, 10) > todayInTashkent()) {
        throw AppErrors.validationFailed(
          'Future status changes are not supported; set the enrollment date for a future admission.',
        );
      }
      if (!dto.reason?.trim())
        throw AppErrors.validationFailed('A status change requires a reason');
      const leaving = ['withdrawn', 'graduated', 'archived'].includes(dto.status);

      await this.tenantPrisma.db.$transaction([
        this.tenantPrisma.db.child.update({
          where: { id },
          data: {
            status: dto.status,
            updatedBy: ctx.userId,
            withdrawalDate: leaving
              ? new Date(dto.effectiveDate)
              : dto.status === 'active'
                ? null
                : undefined,
            enrollmentDate:
              dto.status === 'active' && (!child.enrollmentDate || child.withdrawalDate)
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
        ...(leaving
          ? [
              this.tenantPrisma.db.groupAssignment.updateMany({
                where: {
                  childId: id,
                  effectiveFrom: { lte: new Date(dto.effectiveDate) },
                  OR: [{ effectiveTo: null }, { effectiveTo: { gt: new Date(dto.effectiveDate) } }],
                },
                data: { effectiveTo: new Date(dto.effectiveDate) },
              }),
              this.tenantPrisma.db.childTariff.updateMany({
                where: {
                  childId: id,
                  effectiveFrom: { lte: new Date(dto.effectiveDate) },
                  OR: [{ effectiveTo: null }, { effectiveTo: { gt: new Date(dto.effectiveDate) } }],
                },
                data: { effectiveTo: new Date(dto.effectiveDate) },
              }),
              this.tenantPrisma.db.groupAssignment.deleteMany({
                where: { childId: id, effectiveFrom: { gt: new Date(dto.effectiveDate) } },
              }),
              this.tenantPrisma.db.childTariff.deleteMany({
                where: { childId: id, effectiveFrom: { gt: new Date(dto.effectiveDate) } },
              }),
            ]
          : []),
      ]);

      await this.audit.log({
        userId: ctx.userId,
        action: 'child.status_change',
        entityType: 'child',
        entityId: id,
        oldValue: { status: child.status },
        newValue: { status: dto.status, reason: dto.reason },
      });

      return this.findOneOrThrow(ctx, id, 'child:status');
    });
  }

  async history(ctx: AuthContext, id: string) {
    await this.findOneOrThrow(ctx, id);
    return this.tenantPrisma.db.childStatusHistory.findMany({
      where: { childId: id },
      orderBy: { effectiveDate: 'desc' },
    });
  }

  async remove(ctx: AuthContext, id: string) {
    await this.findOneOrThrow(ctx, id, 'child:delete');
    await this.tenantPrisma.db.child.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.audit.log({
      userId: ctx.userId,
      action: 'child.delete',
      entityType: 'child',
      entityId: id,
    });
  }
}
