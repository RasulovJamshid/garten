import { Injectable } from '@nestjs/common';
import { TenantPrisma } from '../prisma/tenant-prisma.provider';
import { RbacSafetyService } from '../rbac/rbac-safety.service';
import { PermissionResolverService } from '../rbac/permission-resolver.service';
import { PasswordService } from '../auth/password.service';
import { AuditService } from '../audit/audit.service';
import { AppErrors } from '../common/exceptions/app.exception';
import { AuthContext } from '../common/auth-context';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { AssignRoleDto } from './dto/assign-role.dto';
import { PermissionOverrideDto } from './dto/permission-override.dto';

const USER_SUMMARY_SELECT = {
  id: true,
  fullName: true,
  phone: true,
  email: true,
  username: true,
  language: true,
  status: true,
  lastLoginAt: true,
  createdAt: true,
} as const;

@Injectable()
export class UsersService {
  constructor(
    private readonly tenantPrisma: TenantPrisma,
    private readonly safety: RbacSafetyService,
    private readonly resolver: PermissionResolverService,
    private readonly passwords: PasswordService,
    private readonly audit: AuditService,
  ) {}

  async list(filters: { status?: string; branchId?: string }) {
    const where: Record<string, unknown> = { deletedAt: null };
    if (filters.status) where.status = filters.status;
    if (filters.branchId) where.userBranch = { some: { branchId: filters.branchId } };

    return this.tenantPrisma.db.appUser.findMany({ where, select: USER_SUMMARY_SELECT });
  }

  async findOneOrThrow(id: string) {
    const user = await this.tenantPrisma.db.appUser.findUnique({
      where: { id },
      select: USER_SUMMARY_SELECT,
    });
    if (!user) throw AppErrors.notFound('User not found');
    return user;
  }

  async create(ctx: AuthContext, dto: CreateUserDto) {
    const passwordHash = await this.passwords.hash(dto.password);

    const user = await this.tenantPrisma.db.$transaction(async (tx) => {
      const created = await tx.appUser.create({
        data: {
          tenantId: this.tenantPrisma.tenantId,
          fullName: dto.fullName,
          phone: dto.phone,
          email: dto.email,
          username: dto.username,
          passwordHash,
          createdBy: ctx.userId,
          userBranch: { create: dto.branchIds.map((branchId) => ({ branchId })) },
          userRole: {
            create: dto.branchIds.map((branchId) => ({
              roleId: dto.roleId,
              branchId,
              grantedBy: ctx.userId,
            })),
          },
        },
        select: USER_SUMMARY_SELECT,
      });
      return created;
    });

    await this.audit.log({
      userId: ctx.userId,
      action: 'user.create',
      entityType: 'user',
      entityId: user.id,
      newValue: { fullName: user.fullName, phone: user.phone, roleId: dto.roleId },
    });

    return user;
  }

  async update(ctx: AuthContext, id: string, dto: UpdateUserDto) {
    const before = await this.findOneOrThrow(id);

    const data: Record<string, unknown> = {
      fullName: dto.fullName,
      phone: dto.phone,
      email: dto.email,
      language: dto.language,
    };
    if (dto.password) {
      data.passwordHash = await this.passwords.hash(dto.password);
      data.failedAttempts = 0;
      data.lockedUntil = null;
    }

    const updated = await this.tenantPrisma.db.appUser.update({
      where: { id },
      data,
      select: USER_SUMMARY_SELECT,
    });

    await this.audit.log({
      userId: ctx.userId,
      action: 'user.update',
      entityType: 'user',
      entityId: id,
      oldValue: { fullName: before.fullName, phone: before.phone, email: before.email },
      newValue: { fullName: updated.fullName, phone: updated.phone, email: updated.email },
    });

    return updated;
  }

  async setActive(ctx: AuthContext, id: string, active: boolean) {
    await this.findOneOrThrow(id);

    if (!active) {
      // Deactivating removes ALL of your own access, not just role:manage/
      // user:manage — the generic self-lockout diff check doesn't cover
      // that, so this is a blanket rule instead.
      if (id === ctx.userId) {
        throw AppErrors.selfLockout('Cannot deactivate your own account');
      }

      const ownerRole = await this.tenantPrisma.db.role.findFirst({
        where: { code: 'owner' },
        select: { id: true },
      });

      await this.tenantPrisma.db.$transaction(async (tx) => {
        await tx.appUser.update({ where: { id }, data: { status: 'inactive' } });
        if (ownerRole) {
          // No-op unless `id` actually held Owner — the count simply
          // won't have dropped to zero otherwise.
          await this.safety.assertNotLastOwner(tx, ctx.tenantId, ownerRole.id);
        }
      });

      // Kill every live refresh session so the account can't silently
      // renew itself. The current (<=15 min) access token still works
      // until it naturally expires — the accepted tradeoff of short-lived
      // stateless JWTs (JWT_ACCESS_TTL).
      await this.tenantPrisma.db.userSession.updateMany({
        where: { userId: id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    } else {
      await this.tenantPrisma.db.appUser.update({ where: { id }, data: { status: 'active' } });
    }

    await this.audit.log({
      userId: ctx.userId,
      action: active ? 'user.activate' : 'user.deactivate',
      entityType: 'user',
      entityId: id,
    });

    return this.findOneOrThrow(id);
  }

  async loginHistory(id: string) {
    await this.findOneOrThrow(id);
    // login_attempt has no user_id FK (it's keyed by the raw `login` string,
    // since a failed attempt may not resolve to a known user) — join by
    // matching phone/email/username instead.
    const user = await this.tenantPrisma.db.appUser.findUniqueOrThrow({
      where: { id },
      select: { phone: true, email: true, username: true },
    });
    const logins = [user.phone, user.email, user.username].filter((v): v is string => !!v);

    return this.tenantPrisma.db.loginAttempt.findMany({
      where: { login: { in: logins } },
      orderBy: { attemptedAt: 'desc' },
      take: 100,
    });
  }

  // --- role assignment ---------------------------------------------------

  async rolesOf(id: string) {
    await this.findOneOrThrow(id);
    return this.tenantPrisma.db.userRole.findMany({
      where: { userId: id },
      include: {
        role: { select: { id: true, code: true, nameUz: true, nameRu: true } },
        branch: { select: { id: true, code: true } },
      },
    });
  }

  async assignRole(ctx: AuthContext, id: string, dto: AssignRoleDto) {
    await this.findOneOrThrow(id);
    const role = await this.tenantPrisma.db.role.findUnique({ where: { id: dto.roleId } });
    if (!role) throw AppErrors.notFound('Role not found');

    // Granting a role means granting everything it holds — the acting user
    // must hold every permission the role carries (or be blocked as
    // privilege escalation) unless they're only touching their own account,
    // which assignRole never is by definition of granting *to* someone else
    // for the first time... but re-grants can happen to self too, so check
    // uniformly.
    const grants = await this.tenantPrisma.db.rolePermission.findMany({
      where: { roleId: dto.roleId },
    });
    for (const grant of grants) {
      this.safety.assertCanGrant(ctx, grant.permissionKey);
    }

    const branchIds = dto.branchId
      ? [dto.branchId]
      : (
          await this.tenantPrisma.db.userBranch.findMany({
            where: { userId: id },
            select: { branchId: true },
          })
        ).map((b) => b.branchId);

    if (branchIds.length === 0) {
      throw AppErrors.validationFailed('User has no branch access yet — pass branchId explicitly');
    }

    await this.tenantPrisma.db.$transaction(async (tx) => {
      for (const branchId of branchIds) {
        await tx.userRole.upsert({
          where: { userId_roleId_branchId: { userId: id, roleId: dto.roleId, branchId } },
          create: { userId: id, roleId: dto.roleId, branchId, grantedBy: ctx.userId },
          update: {},
        });
      }
      await this.safety.assertNoSelfLockout(ctx, id, tx);
    });

    await this.audit.log({
      userId: ctx.userId,
      action: 'user.role_assign',
      entityType: 'user',
      entityId: id,
      newValue: { roleId: dto.roleId, branchIds },
    });

    return this.rolesOf(id);
  }

  async replaceRoles(ctx: AuthContext, id: string, assignments: AssignRoleDto[]) {
    await this.findOneOrThrow(id);
    const userBranchIds = (
      await this.tenantPrisma.db.userBranch.findMany({
        where: { userId: id },
        select: { branchId: true },
      })
    ).map((b) => b.branchId);

    const rows: { roleId: string; branchId: string }[] = [];
    for (const a of assignments) {
      const role = await this.tenantPrisma.db.role.findUnique({ where: { id: a.roleId } });
      if (!role) throw AppErrors.notFound(`Role ${a.roleId} not found`);
      const grants = await this.tenantPrisma.db.rolePermission.findMany({
        where: { roleId: a.roleId },
      });
      for (const grant of grants) this.safety.assertCanGrant(ctx, grant.permissionKey);

      const branchIds = a.branchId ? [a.branchId] : userBranchIds;
      if (branchIds.length === 0) {
        throw AppErrors.validationFailed(
          'User has no branch access yet — pass branchId explicitly',
        );
      }
      rows.push(...branchIds.map((branchId) => ({ roleId: a.roleId, branchId })));
    }

    const ownerRole = await this.tenantPrisma.db.role.findFirst({
      where: { code: 'owner' },
      select: { id: true },
    });

    await this.tenantPrisma.db.$transaction(async (tx) => {
      await tx.userRole.deleteMany({ where: { userId: id } });
      if (rows.length > 0) {
        await tx.userRole.createMany({
          data: rows.map((r) => ({
            userId: id,
            roleId: r.roleId,
            branchId: r.branchId,
            grantedBy: ctx.userId,
          })),
        });
      }
      if (ownerRole) {
        await this.safety.assertNotLastOwner(tx, ctx.tenantId, ownerRole.id);
      }
      await this.safety.assertNoSelfLockout(ctx, id, tx);
    });

    await this.audit.log({
      userId: ctx.userId,
      action: 'user.role_assign',
      entityType: 'user',
      entityId: id,
      newValue: { roles: assignments },
    });

    return this.rolesOf(id);
  }

  async removeRole(ctx: AuthContext, id: string, roleId: string, branchId?: string) {
    await this.findOneOrThrow(id);
    const role = await this.tenantPrisma.db.role.findUnique({ where: { id: roleId } });
    if (!role) throw AppErrors.notFound('Role not found');

    await this.tenantPrisma.db.$transaction(async (tx) => {
      await tx.userRole.deleteMany({
        where: { userId: id, roleId, ...(branchId && { branchId }) },
      });

      if (role.isProtected || role.code === 'owner') {
        await this.safety.assertNotLastOwner(tx, ctx.tenantId, roleId);
      }
      await this.safety.assertNoSelfLockout(ctx, id, tx);
    });

    await this.audit.log({
      userId: ctx.userId,
      action: 'user.role_remove',
      entityType: 'user',
      entityId: id,
      oldValue: { roleId, branchId },
    });
  }

  async effectivePermissions(id: string) {
    await this.findOneOrThrow(id);
    const resolved = await this.resolver.resolve(id);
    return { userId: id, permissions: Object.fromEntries(resolved) };
  }

  // --- per-user overrides --------------------------------------------------

  async overridesOf(id: string) {
    await this.findOneOrThrow(id);
    return this.tenantPrisma.db.userPermissionOverride.findMany({ where: { userId: id } });
  }

  async setOverride(ctx: AuthContext, id: string, dto: PermissionOverrideDto) {
    await this.findOneOrThrow(id);
    if (!ctx.has('role:manage:sensitive')) {
      throw AppErrors.sensitivePermission(
        'Setting a permission override requires role:manage:sensitive',
      );
    }
    if (dto.effect === 'grant') {
      this.safety.assertGrantable(ctx, dto.key, dto.scope);
    } else {
      this.safety.assertPermissionExists(dto.key);
    }

    await this.tenantPrisma.db.$transaction(async (tx) => {
      await tx.userPermissionOverride.upsert({
        where: { userId_permissionKey: { userId: id, permissionKey: dto.key } },
        create: {
          userId: id,
          permissionKey: dto.key,
          scope: dto.scope,
          effect: dto.effect,
          reason: dto.reason,
          validUntil: dto.validUntil ? new Date(dto.validUntil) : null,
          grantedBy: ctx.userId,
        },
        update: {
          scope: dto.scope,
          effect: dto.effect,
          reason: dto.reason,
          validUntil: dto.validUntil ? new Date(dto.validUntil) : null,
          grantedBy: ctx.userId,
        },
      });
      await this.safety.assertNoSelfLockout(ctx, id, tx);
    });

    await this.audit.log({
      userId: ctx.userId,
      action: 'user.override_set',
      entityType: 'user',
      entityId: id,
      newValue: { key: dto.key, scope: dto.scope, effect: dto.effect, reason: dto.reason },
    });

    return this.overridesOf(id);
  }

  async removeOverride(ctx: AuthContext, id: string, key: string) {
    await this.findOneOrThrow(id);
    await this.tenantPrisma.db.$transaction(async (tx) => {
      await tx.userPermissionOverride.delete({
        where: { userId_permissionKey: { userId: id, permissionKey: key } },
      });
      await this.safety.assertNoSelfLockout(ctx, id, tx);
    });

    await this.audit.log({
      userId: ctx.userId,
      action: 'user.override_set',
      entityType: 'user',
      entityId: id,
      oldValue: { key, removed: true },
    });
  }
}
