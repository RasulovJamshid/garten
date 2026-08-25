import { Injectable } from '@nestjs/common';
import { TenantPrisma } from '../prisma/tenant-prisma.provider';
import { RbacSafetyService } from '../rbac/rbac-safety.service';
import { AuditService } from '../audit/audit.service';
import { AppErrors } from '../common/exceptions/app.exception';
import { AuthContext } from '../common/auth-context';
import { PERMISSION_CATALOG } from '../rbac/permission-catalog';
import { CreateRoleDto } from './dto/create-role.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
import { ReplacePermissionsDto } from './dto/replace-permissions.dto';
import { CloneRoleDto } from './dto/clone-role.dto';
import { PermissionGrantDto } from './dto/permission-grant.dto';

@Injectable()
export class RolesService {
  constructor(
    private readonly tenantPrisma: TenantPrisma,
    private readonly safety: RbacSafetyService,
    private readonly audit: AuditService,
  ) {}

  async list(includeSystem: boolean) {
    const roles = await this.tenantPrisma.db.role.findMany({
      where: includeSystem ? {} : { isSystem: false },
      orderBy: { createdAt: 'asc' },
      include: { _count: { select: { userRole: true, rolePermission: true } } },
    });
    return roles.map((r) => ({
      id: r.id,
      code: r.code,
      nameUz: r.nameUz,
      nameRu: r.nameRu,
      description: r.description,
      isSystem: r.isSystem,
      isProtected: r.isProtected,
      userCount: r._count.userRole,
      permissionCount: r._count.rolePermission,
    }));
  }

  async findOneOrThrow(id: string) {
    const role = await this.tenantPrisma.db.role.findUnique({
      where: { id },
      include: { rolePermission: { select: { permissionKey: true, scope: true } } },
    });
    if (!role) throw AppErrors.notFound('Role not found');
    return role;
  }

  async get(id: string) {
    const role = await this.findOneOrThrow(id);
    return {
      id: role.id,
      code: role.code,
      nameUz: role.nameUz,
      nameRu: role.nameRu,
      description: role.description,
      isSystem: role.isSystem,
      isProtected: role.isProtected,
      permissions: role.rolePermission.map((p) => ({ key: p.permissionKey, scope: p.scope })),
    };
  }

  async create(ctx: AuthContext, dto: CreateRoleDto) {
    for (const grant of dto.permissions) {
      this.safety.assertGrantable(ctx, grant.key, grant.scope);
    }

    const role = await this.tenantPrisma.db.role.create({
      data: {
        tenantId: this.tenantPrisma.tenantId,
        code: dto.code,
        nameUz: dto.nameUz,
        nameRu: dto.nameRu,
        description: dto.description,
        createdBy: ctx.userId,
        rolePermission: {
          create: dto.permissions.map((g) => ({
            permissionKey: g.key,
            scope: g.scope,
            grantedBy: ctx.userId,
          })),
        },
      },
      include: { rolePermission: true },
    });

    await this.audit.log({
      userId: ctx.userId,
      action: 'role.create',
      entityType: 'role',
      entityId: role.id,
      newValue: { code: role.code, permissions: dto.permissions },
    });

    return this.get(role.id);
  }

  async update(ctx: AuthContext, id: string, dto: UpdateRoleDto) {
    const role = await this.findOneOrThrow(id);
    this.safety.assertNotProtected(role, 'edit');

    const updated = await this.tenantPrisma.db.role.update({
      where: { id },
      data: { nameUz: dto.nameUz, nameRu: dto.nameRu, description: dto.description },
    });

    await this.audit.log({
      userId: ctx.userId,
      action: 'role.update',
      entityType: 'role',
      entityId: id,
      oldValue: { nameUz: role.nameUz, nameRu: role.nameRu, description: role.description },
      newValue: {
        nameUz: updated.nameUz,
        nameRu: updated.nameRu,
        description: updated.description,
      },
    });

    return this.get(id);
  }

  async remove(ctx: AuthContext, id: string) {
    const role = await this.findOneOrThrow(id);
    this.safety.assertNotProtected(role, 'delete');

    const holders = await this.tenantPrisma.db.userRole.count({ where: { roleId: id } });
    if (holders > 0) {
      throw AppErrors.conflict('ROLE_IN_USE: users still hold this role; reassign first');
    }

    await this.tenantPrisma.db.role.delete({ where: { id } });
    await this.audit.log({
      userId: ctx.userId,
      action: 'role.delete',
      entityType: 'role',
      entityId: id,
      oldValue: { code: role.code },
    });
  }

  async clone(ctx: AuthContext, id: string, dto: CloneRoleDto) {
    const source = await this.findOneOrThrow(id);

    const clone = await this.tenantPrisma.db.role.create({
      data: {
        tenantId: this.tenantPrisma.tenantId,
        code: dto.code,
        nameUz: dto.nameUz,
        nameRu: dto.nameRu,
        description: source.description,
        createdBy: ctx.userId,
        rolePermission: {
          create: source.rolePermission.map((p) => ({
            permissionKey: p.permissionKey,
            scope: p.scope,
            grantedBy: ctx.userId,
          })),
        },
      },
    });

    await this.audit.log({
      userId: ctx.userId,
      action: 'role.create',
      entityType: 'role',
      entityId: clone.id,
      newValue: { code: clone.code, clonedFrom: source.code },
    });

    return this.get(clone.id);
  }

  /** Full replacement — the matrix-save endpoint. */
  async replacePermissions(ctx: AuthContext, id: string, dto: ReplacePermissionsDto) {
    const role = await this.findOneOrThrow(id);
    this.safety.assertNotProtected(role, 'modify permissions of');
    for (const grant of dto.permissions) {
      this.safety.assertGrantable(ctx, grant.key, grant.scope);
    }

    const actingUserHoldsThisRole = await this.tenantPrisma.db.userRole.findFirst({
      where: { roleId: id, userId: ctx.userId },
      select: { userId: true },
    });

    const before = role.rolePermission.map((p) => ({ key: p.permissionKey, scope: p.scope }));

    await this.tenantPrisma.db.$transaction(async (tx) => {
      await tx.rolePermission.deleteMany({ where: { roleId: id } });
      if (dto.permissions.length > 0) {
        await tx.rolePermission.createMany({
          data: dto.permissions.map((g) => ({
            roleId: id,
            permissionKey: g.key,
            scope: g.scope,
            grantedBy: ctx.userId,
          })),
        });
      }
      if (actingUserHoldsThisRole) {
        await this.safety.assertNoSelfLockout(ctx, ctx.userId, tx);
      }
    });

    await this.audit.log({
      userId: ctx.userId,
      action: 'role.grant',
      entityType: 'role',
      entityId: id,
      oldValue: { permissions: before },
      newValue: { permissions: dto.permissions },
    });

    return this.get(id);
  }

  async grantOne(ctx: AuthContext, id: string, dto: PermissionGrantDto) {
    const role = await this.findOneOrThrow(id);
    this.safety.assertNotProtected(role, 'modify permissions of');
    this.safety.assertGrantable(ctx, dto.key, dto.scope);

    await this.tenantPrisma.db.rolePermission.upsert({
      where: { roleId_permissionKey: { roleId: id, permissionKey: dto.key } },
      create: { roleId: id, permissionKey: dto.key, scope: dto.scope, grantedBy: ctx.userId },
      update: { scope: dto.scope, grantedBy: ctx.userId },
    });

    await this.audit.log({
      userId: ctx.userId,
      action: 'role.grant',
      entityType: 'role',
      entityId: id,
      newValue: { key: dto.key, scope: dto.scope },
    });

    return this.get(id);
  }

  async revokeOne(ctx: AuthContext, id: string, key: string) {
    const role = await this.findOneOrThrow(id);
    this.safety.assertNotProtected(role, 'modify permissions of');

    const actingUserHoldsThisRole = await this.tenantPrisma.db.userRole.findFirst({
      where: { roleId: id, userId: ctx.userId },
      select: { userId: true },
    });

    await this.tenantPrisma.db.$transaction(async (tx) => {
      await tx.rolePermission.delete({
        where: { roleId_permissionKey: { roleId: id, permissionKey: key } },
      });
      if (actingUserHoldsThisRole) {
        await this.safety.assertNoSelfLockout(ctx, ctx.userId, tx);
      }
    });

    await this.audit.log({
      userId: ctx.userId,
      action: 'role.revoke',
      entityType: 'role',
      entityId: id,
      oldValue: { key },
    });
  }

  async usersOf(id: string) {
    await this.findOneOrThrow(id);
    const rows = await this.tenantPrisma.db.userRole.findMany({
      where: { roleId: id },
      include: {
        appUser: { select: { id: true, fullName: true, email: true, phone: true, status: true } },
      },
    });
    // dedupe (a user can hold the same role at multiple branches)
    return [...new Map(rows.map((r) => [r.appUser.id, r.appUser])).values()];
  }

  async matrix() {
    const roles = await this.tenantPrisma.db.role.findMany({
      include: { rolePermission: { select: { permissionKey: true, scope: true } } },
      orderBy: { createdAt: 'asc' },
    });
    return {
      permissions: PERMISSION_CATALOG.map((p) => ({
        key: p.key,
        group: p.group,
        sensitive: p.sensitive ?? false,
      })),
      roles: roles.map((r) => ({
        id: r.id,
        code: r.code,
        isProtected: r.isProtected,
        grants: Object.fromEntries(r.rolePermission.map((p) => [p.permissionKey, p.scope])),
      })),
    };
  }

  async diff(id: string, againstId: string) {
    const [a, b] = await Promise.all([this.findOneOrThrow(id), this.findOneOrThrow(againstId)]);
    const aMap = new Map(a.rolePermission.map((p) => [p.permissionKey, p.scope]));
    const bMap = new Map(b.rolePermission.map((p) => [p.permissionKey, p.scope]));
    const keys = new Set([...aMap.keys(), ...bMap.keys()]);

    const onlyInA: string[] = [];
    const onlyInB: string[] = [];
    const differentScope: { key: string; a: string; b: string }[] = [];

    for (const key of keys) {
      const av = aMap.get(key);
      const bv = bMap.get(key);
      if (av && !bv) onlyInA.push(key);
      else if (bv && !av) onlyInB.push(key);
      else if (av !== bv) differentScope.push({ key, a: av!, b: bv! });
    }

    return { role: a.code, against: b.code, onlyInA, onlyInB, differentScope };
  }
}
