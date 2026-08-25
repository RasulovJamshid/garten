import { Injectable } from '@nestjs/common';
import { TenantPrisma } from '../prisma/tenant-prisma.provider';
import { AuditService } from '../audit/audit.service';
import { AppErrors } from '../common/exceptions/app.exception';
import { AuthContext } from '../common/auth-context';
import { CreateGroupDto } from './dto/create-group.dto';
import { UpdateGroupDto } from './dto/update-group.dto';
import { AssignChildDto } from './dto/assign-child.dto';
import { TransferChildDto } from './dto/transfer-child.dto';
import { SetStaffDto } from './dto/set-staff.dto';

type StaffRole = 'main_teacher' | 'assistant' | 'nurse';

@Injectable()
export class GroupsService {
  constructor(
    private readonly tenantPrisma: TenantPrisma,
    private readonly audit: AuditService,
  ) {}

  private scopedWhere(ctx: AuthContext): Record<string, unknown> {
    const scope = ctx.scopeFor('group:read');
    if (!scope) throw AppErrors.forbidden("Missing permission: 'group:read'");
    if (scope === 'all') return {};
    if (scope === 'branch') return { branchId: { in: ctx.branchIds } };
    throw AppErrors.invalidScope(`Unsupported scope '${scope}' for group:read`);
  }

  async list(ctx: AuthContext, filters: { branchId?: string; status?: string }) {
    const where: Record<string, unknown> = { ...this.scopedWhere(ctx), deletedAt: null };
    if (filters.branchId) where.branchId = filters.branchId;
    if (filters.status) where.status = filters.status;

    const groups = await this.tenantPrisma.db.childGroup.findMany({
      where,
      include: { _count: { select: { groupAssignment: { where: { effectiveTo: null } } } } },
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

  async findOneOrThrow(ctx: AuthContext, id: string) {
    const group = await this.tenantPrisma.db.childGroup.findFirst({
      where: { id, ...this.scopedWhere(ctx), deletedAt: null },
      include: { _count: { select: { groupAssignment: { where: { effectiveTo: null } } } } },
    });
    if (!group) throw AppErrors.notFound('Group not found');
    return this.withCounts(group);
  }

  async create(ctx: AuthContext, dto: CreateGroupDto) {
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
    await this.findOneOrThrow(ctx, id);

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

  async childrenOf(id: string) {
    const rows = await this.tenantPrisma.db.groupAssignment.findMany({
      where: { groupId: id, effectiveTo: null },
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
    const group = await this.findOneOrThrow(ctx, groupId);

    if (!force && group.currentCount >= group.capacity) {
      throw AppErrors.conflict('CAPACITY_EXCEEDED: group is at capacity');
    }
    if (force && !ctx.has('group:capacity_override')) {
      throw AppErrors.forbidden("force=true requires 'group:capacity_override'");
    }

    const effectiveFrom = new Date(effectiveDate);
    const dayBefore = new Date(effectiveFrom);
    dayBefore.setDate(dayBefore.getDate() - 1);

    await this.tenantPrisma.db.$transaction(async (tx) => {
      const current = await tx.groupAssignment.findFirst({ where: { childId, effectiveTo: null } });
      if (current) {
        if (current.groupId === groupId) return; // already here — no-op
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
    return this.childrenOf(groupId);
  }

  async transfer(ctx: AuthContext, groupId: string, dto: TransferChildDto, force: boolean) {
    // `groupId` (the URL's :id) is informational context only — the source
    // group is derived from the child's current assignment, matching the
    // documented { childId, toGroupId } body shape.
    await this.reassignChild(ctx, dto.toGroupId, dto.childId, dto.effectiveDate, dto.reason, force);
    return this.childrenOf(dto.toGroupId);
  }

  async history(id: string) {
    return this.tenantPrisma.db.groupAssignment.findMany({
      where: { groupId: id },
      include: { child: { select: { firstName: true, lastName: true } } },
      orderBy: { effectiveFrom: 'desc' },
    });
  }

  async staffOf(id: string) {
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
    await this.findOneOrThrow(ctx, id);

    await this.tenantPrisma.db.$transaction(async (tx) => {
      const assignments: [StaffRole, string | undefined][] = [
        ['main_teacher', dto.mainTeacherId],
        ['assistant', dto.assistantTeacherId],
        ['nurse', dto.nurseId],
      ];
      for (const [role, userId] of assignments) {
        if (userId === undefined) continue;
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
        await tx.groupStaff.create({
          data: { tenantId: this.tenantPrisma.tenantId, groupId: id, userId, staffRole: role },
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

    return this.staffOf(id);
  }
}
