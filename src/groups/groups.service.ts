import { Injectable } from '@nestjs/common';
import { TenantPrisma } from '../prisma/tenant-prisma.provider';
import { AuditService } from '../audit/audit.service';
import { AppErrors } from '../common/exceptions/app.exception';
import { AuthContext } from '../common/auth-context';
import { andWhere } from '../common/prisma-where';
import { CreateGroupDto } from './dto/create-group.dto';
import { UpdateGroupDto } from './dto/update-group.dto';
import { AssignChildDto } from './dto/assign-child.dto';
import { TransferChildDto } from './dto/transfer-child.dto';
import { effectiveOn } from '../common/tashkent-date';
import { SetStaffDto } from './dto/set-staff.dto';

type StaffRole = 'main_teacher' | 'assistant' | 'nurse';

@Injectable()
export class GroupsService {
  constructor(
    private readonly tenantPrisma: TenantPrisma,
    private readonly audit: AuditService,
  ) {}

  private scopedWhere(ctx: AuthContext, permission = 'group:read'): Record<string, unknown> {
    const scope = ctx.scopeFor(permission);
    if (!scope) throw AppErrors.forbidden("Missing permission: 'group:read'");
    if (scope === 'all') return {};
    if (scope === 'own_group') return { id: { in: ctx.requireOwnGroupIds() } };
    if (scope === 'branch') return { branchId: { in: ctx.requireBranchIds(permission) } };
    throw AppErrors.invalidScope(`Unsupported scope '${scope}' for group:read`);
  }

  async list(ctx: AuthContext, filters: { branchId?: string; status?: string }) {
    // `branchId` collides with the branch scope clause — AND, never assign.
    let where = andWhere({ deletedAt: null }, this.scopedWhere(ctx));
    if (filters.branchId) where = andWhere(where, { branchId: filters.branchId });
    if (filters.status) where = andWhere(where, { status: filters.status });

    const groups = await this.tenantPrisma.db.childGroup.findMany({
      where,
      include: {
        _count: {
          select: { groupAssignment: { where: { ...effectiveOn(), child: { deletedAt: null } } } },
        },
      },
      orderBy: { name: 'asc' },
    });

    return groups.map((g) => this.withCounts(g));
  }

  private withCounts<T extends { capacity: number; _count: { groupAssignment: number } }>(g: T) {
    const { _count, ...rest } = g;
    return {
      ...rest,
      currentCount: _count.groupAssignment,
      availablePlaces: g.capacity - _count.groupAssignment,
    };
  }

  async findOneOrThrow(ctx: AuthContext, id: string, permission = 'group:read') {
    const group = await this.tenantPrisma.db.childGroup.findFirst({
      where: andWhere({ id, deletedAt: null }, this.scopedWhere(ctx, permission)),
      include: {
        _count: {
          select: { groupAssignment: { where: { ...effectiveOn(), child: { deletedAt: null } } } },
        },
      },
    });
    if (!group) throw AppErrors.notFound('Group not found');
    return this.withCounts(group);
  }

  async create(ctx: AuthContext, dto: CreateGroupDto) {
    await this.tenantPrisma.assertBranch(dto.branchId, 'group:manage');
    const group = await this.tenantPrisma.db.childGroup.create({
      data: {
        tenantId: this.tenantPrisma.tenantId,
        branchId: dto.branchId,
        name: dto.name,
        ageMinMonths: dto.ageMinMonths,
        ageMaxMonths: dto.ageMaxMonths,
        capacity: dto.capacity ?? 20,
        workingHours: dto.workingHours as any,
      },
    });

    await this.audit.log({
      userId: ctx.userId,
      action: 'settings.update',
      entityType: 'child_group',
      entityId: group.id,
      newValue: { name: group.name, capacity: group.capacity },
    });

    return group;
  }

  async update(ctx: AuthContext, id: string, dto: UpdateGroupDto) {
    await this.findOneOrThrow(ctx, id, 'group:manage');

    const updated = await this.tenantPrisma.db.childGroup.update({
      where: { id },
      data: {
        name: dto.name,
        ageMinMonths: dto.ageMinMonths,
        ageMaxMonths: dto.ageMaxMonths,
        capacity: dto.capacity,
        workingHours: dto.workingHours as any,
        status: dto.status,
      },
    });

    await this.audit.log({
      userId: ctx.userId,
      action: 'settings.update',
      entityType: 'child_group',
      entityId: id,
      newValue: { name: updated.name, capacity: updated.capacity, status: updated.status },
    });

    return updated;
  }

  /**
   * Takes ctx and goes through findOneOrThrow so the group itself is
   * scope-checked first: these used to be reachable by id alone, which
   * let a branch-scoped user read another branch's roster, staff list,
   * or assignment history. Tenant isolation held; branch scope did not.
   */
  async childrenOf(ctx: AuthContext, id: string, permission = 'group:read') {
    await this.findOneOrThrow(ctx, id, permission);
    const rows = await this.tenantPrisma.db.groupAssignment.findMany({
      where: { groupId: id, ...effectiveOn(), child: { deletedAt: null } },
      include: {
        child: {
          select: { id: true, firstName: true, lastName: true, birthDate: true, status: true },
        },
      },
    });
    return rows.map((r) => r.child);
  }

  /**
   * Shared by "join a group" and "transfer" — both are, at the ledger
   * level, the same operation: close the child's current assignment (if
   * any) and open a new one. The DB's `no_overlapping_group` exclusion
   * constraint is the real guarantee; this just avoids relying on it to
   * surface a raw constraint-violation 500 for the common case.
   */
  private async reassignChild(
    ctx: AuthContext,
    groupId: string,
    childId: string,
    effectiveDate: string,
    reason: string | undefined,
    force: boolean,
  ) {
    const group = await this.findOneOrThrow(ctx, groupId, 'group:manage');
    const child = await this.tenantPrisma.assertChild(childId, 'group:manage');
    if (group.status !== 'active') throw AppErrors.conflict('GROUP_NOT_ACTIVE');
    if (child.branchId !== group.branchId)
      throw AppErrors.validationFailed(
        'Transfer to another branch requires moving the child branch first',
      );

    if (force && !ctx.has('group:capacity_override')) {
      throw AppErrors.forbidden("force=true requires 'group:capacity_override'");
    }

    const effectiveFrom = new Date(effectiveDate);
    const dayBefore = new Date(effectiveFrom);
    dayBefore.setUTCDate(dayBefore.getUTCDate() - 1);

    await this.tenantPrisma.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM child_group WHERE id = ${groupId}::uuid AND tenant_id = ${ctx.tenantId}::uuid FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM child WHERE id = ${childId}::uuid AND tenant_id = ${ctx.tenantId}::uuid FOR UPDATE`;
      const current = await tx.groupAssignment.findFirst({
        where: { childId, ...effectiveOn(effectiveDate) },
      });
      if (current?.groupId === groupId) return;
      const reserved = await tx.groupAssignment.findMany({
        where: {
          groupId,
          OR: [{ effectiveTo: null }, { effectiveTo: { gte: effectiveFrom } }],
          child: { deletedAt: null },
        },
        select: { effectiveFrom: true, effectiveTo: true },
      });
      const events = new Map<number, number>();
      for (const assignment of reserved) {
        const start = Math.max(effectiveFrom.getTime(), assignment.effectiveFrom.getTime());
        events.set(start, (events.get(start) ?? 0) + 1);
        if (assignment.effectiveTo) {
          const end = assignment.effectiveTo.getTime() + 86400000;
          events.set(end, (events.get(end) ?? 0) - 1);
        }
      }
      let count = 0,
        occupancy = 0;
      for (const [, delta] of [...events].sort(([a], [b]) => a - b)) {
        occupancy += delta;
        count = Math.max(count, occupancy);
      }
      if (!force && count >= group.capacity)
        throw AppErrors.conflict(
          'CAPACITY_EXCEEDED: group is at capacity on or after the transfer date',
        );
      if (
        await tx.groupAssignment.findFirst({
          where: { childId, effectiveFrom: { gt: effectiveFrom } },
        })
      )
        throw AppErrors.conflict('FUTURE_ASSIGNMENT_EXISTS: update the scheduled transfer first');
      if (current) {
        if (current.groupId === groupId) return; // already here — no-op
        if (current.effectiveFrom.getTime() === effectiveFrom.getTime())
          await tx.groupAssignment.delete({ where: { id: current.id } });
        else
          await tx.groupAssignment.update({
            where: { id: current.id },
            data: { effectiveTo: dayBefore },
          });
      }
      await tx.groupAssignment.create({
        data: {
          tenantId: this.tenantPrisma.tenantId,
          childId,
          groupId,
          effectiveFrom,
          reason,
          assignedBy: ctx.userId,
        },
      });
    });

    await this.audit.log({
      userId: ctx.userId,
      action: 'child.group_transfer',
      entityType: 'child',
      entityId: childId,
      newValue: { groupId, effectiveDate, force },
    });
  }

  async assignChild(ctx: AuthContext, groupId: string, dto: AssignChildDto, force: boolean) {
    await this.reassignChild(ctx, groupId, dto.childId, dto.effectiveDate, undefined, force);
    return this.childrenOf(ctx, groupId, 'group:manage');
  }

  async transfer(ctx: AuthContext, groupId: string, dto: TransferChildDto, force: boolean) {
    // `groupId` (the URL's :id) is informational context only — the source
    // group is derived from the child's current assignment, matching the
    // documented { childId, toGroupId } body shape.
    await this.reassignChild(ctx, dto.toGroupId, dto.childId, dto.effectiveDate, dto.reason, force);
    return this.childrenOf(ctx, dto.toGroupId, 'group:manage');
  }

  async history(ctx: AuthContext, id: string) {
    await this.findOneOrThrow(ctx, id);
    return this.tenantPrisma.db.groupAssignment.findMany({
      where: { groupId: id },
      include: { child: { select: { firstName: true, lastName: true } } },
      orderBy: { effectiveFrom: 'desc' },
    });
  }

  async staffOf(ctx: AuthContext, id: string) {
    await this.findOneOrThrow(ctx, id);
    const rows = await this.tenantPrisma.db.groupStaff.findMany({
      where: { groupId: id, assignedTo: null },
      include: { appUser: { select: { id: true, fullName: true } } },
    });
    return {
      mainTeacher: rows.find((r) => r.staffRole === 'main_teacher')?.appUser ?? null,
      assistant: rows.find((r) => r.staffRole === 'assistant')?.appUser ?? null,
      nurse: rows.find((r) => r.staffRole === 'nurse')?.appUser ?? null,
    };
  }

  async setStaff(ctx: AuthContext, id: string, dto: SetStaffDto) {
    await this.findOneOrThrow(ctx, id, 'group:manage');

    await this.tenantPrisma.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM child_group WHERE id = ${id}::uuid AND tenant_id = ${ctx.tenantId}::uuid FOR UPDATE`;
      const assignments: [StaffRole, string | null | undefined][] = [
        ['main_teacher', dto.mainTeacherId],
        ['assistant', dto.assistantTeacherId],
        ['nurse', dto.nurseId],
      ];
      for (const [role, userId] of assignments) {
        if (userId === undefined) continue;
        if (
          userId &&
          !(await tx.appUser.findFirst({
            where: { id: userId, status: 'active', deletedAt: null },
          }))
        )
          throw AppErrors.notFound('Staff user not found');
        const current = await tx.groupStaff.findFirst({
          where: { groupId: id, staffRole: role, assignedTo: null },
        });
        if (current?.userId === userId) continue;
        if (current) {
          await tx.groupStaff.update({
            where: {
              groupId_userId_staffRole: { groupId: id, userId: current.userId, staffRole: role },
            },
            data: { assignedTo: new Date() },
          });
        }
        if (userId)
          await tx.groupStaff.upsert({
            where: { groupId_userId_staffRole: { groupId: id, userId, staffRole: role } },
            create: { tenantId: this.tenantPrisma.tenantId, groupId: id, userId, staffRole: role },
            update: { assignedFrom: new Date(), assignedTo: null },
          });
      }
    });

    await this.audit.log({
      userId: ctx.userId,
      action: 'settings.update',
      entityType: 'child_group',
      entityId: id,
      newValue: { staff: dto },
    });

    return this.staffOf(ctx, id);
  }
}
