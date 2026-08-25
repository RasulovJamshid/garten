import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { broaderScope, PermissionScope } from '../common/auth-context';

/**
 * The minimal shape `resolve()` actually needs — deliberately typed with
 * `any` args/returns rather than derived from Prisma's generated types.
 * The real callers are the plain PrismaService, a raw `$transaction`
 * client, AND the tenant-extended client's `$transaction` client (a
 * distinct generated type per extension). Prisma's generic `Exact`/
 * `SelectSubset` machinery makes those three mutually incompatible as far
 * as strict structural typing is concerned, even though all three are
 * functionally identical for these two calls. `any` here is the pragmatic
 * boundary, not a hole: everything past this parameter is fully typed.
 */
export interface PrismaLike {
  userRole: {
    findMany(args: any): Promise<any[]>;
  };
  userPermissionOverride: {
    findMany(args: any): Promise<any[]>;
  };
}

/**
 * Resolves "what can this user actually do right now" straight from the
 * database: union of role grants (broadest scope wins across roles),
 * then per-user overrides with deny always beating grant
 * (01-stage1-plan.md §5.2, api-spec §3 "Per-user overrides").
 *
 * A plain singleton, not request-scoped: it takes userId/tenantId as
 * explicit parameters rather than reading them off the current request.
 * A REQUEST-scoped PermissionGuard (inferred from a request-scoped
 * dependency) turned out to break Nest's global-guard DI — Reflector
 * resolved to undefined inside canActivate even with an explicit
 * @Inject(Reflector). Guards that run for every route, before "the
 * current tenant" is even established for @Public() routes, are simpler
 * and more robust as singletons that thread tenantId/userId through
 * method calls instead of leaning on request-scoped injection.
 */
@Injectable()
export class PermissionResolverService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * `client` defaults to the ambient singleton but accepts an in-flight
   * `$transaction` client too — RbacSafetyService uses that to simulate a
   * pending role/grant change and check the self-lockout invariant before
   * committing (see rbac-safety.service.ts).
   */
  async resolve(
    userId: string,
    client: PrismaLike = this.prisma,
  ): Promise<Map<string, PermissionScope>> {
    const [userRoles, overrides] = await Promise.all([
      client.userRole.findMany({
        where: { userId },
        include: { role: { include: { rolePermission: true } } },
      }),
      client.userPermissionOverride.findMany({ where: { userId } }),
    ]);

    const resolved = new Map<string, PermissionScope>();
    for (const userRole of userRoles) {
      for (const grant of userRole.role.rolePermission) {
        const scope = grant.scope as PermissionScope;
        const existing = resolved.get(grant.permissionKey);
        resolved.set(grant.permissionKey, existing ? broaderScope(existing, scope) : scope);
      }
    }

    const now = new Date();
    const active = overrides.filter((o) => !o.validUntil || o.validUntil > now);

    for (const override of active) {
      if (override.effect === 'grant') {
        resolved.set(override.permissionKey, override.scope as PermissionScope);
      }
    }
    // Deny is applied last and unconditionally — it always wins, regardless
    // of what any role or grant-override said.
    for (const override of active) {
      if (override.effect === 'deny') {
        resolved.delete(override.permissionKey);
      }
    }

    return resolved;
  }

  async branchIds(userId: string): Promise<string[]> {
    const rows = await this.prisma.userBranch.findMany({
      where: { userId },
      select: { branchId: true },
    });
    return rows.map((r) => r.branchId);
  }

  async ownGroupIds(userId: string): Promise<string[]> {
    const rows = await this.prisma.groupStaff.findMany({
      where: { userId, assignedTo: null },
      select: { groupId: true },
    });
    return rows.map((r) => r.groupId);
  }
}
