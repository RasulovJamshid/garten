import { Injectable } from '@nestjs/common';
import { AuthContext, PermissionScope } from '../common/auth-context';
import { AppErrors } from '../common/exceptions/app.exception';
import { findPermission, PermissionDef } from './permission-catalog';
import { PermissionResolverService, PrismaLike } from './permission-resolver.service';

/**
 * The safety rails from 01-stage1-plan.md §5.5 — "these prevent the
 * classic self-lockout disaster." Shared by the Roles and Users modules
 * so both enforce the same invariants rather than each reimplementing
 * them slightly differently.
 */
@Injectable()
export class RbacSafetyService {
  constructor(private readonly resolver: PermissionResolverService) {}

  assertNotProtected(role: { isProtected: boolean }, action: string): void {
    if (role.isProtected) {
      throw AppErrors.roleProtected(`Cannot ${action} the protected Owner role`);
    }
  }

  assertPermissionExists(key: string): PermissionDef {
    const def = findPermission(key);
    if (!def) throw AppErrors.unknownPermission(`'${key}' is not in the code catalog`);
    return def;
  }

  assertValidScope(permission: PermissionDef, scope: string): void {
    if (!permission.scopes.includes(scope as PermissionScope)) {
      throw AppErrors.invalidScope(`Scope '${scope}' is not allowed for '${permission.key}'`);
    }
  }

  /** A user cannot grant a permission they do not themselves hold, at any scope. */
  assertCanGrant(ctx: AuthContext, permissionKey: string): void {
    if (!ctx.has(permissionKey)) {
      throw AppErrors.privilegeEscalation(`You do not hold '${permissionKey}' and cannot grant it`);
    }
  }

  /** Granting a `sensitive` permission requires the actor to hold role:manage:sensitive. */
  assertCanGrantSensitive(ctx: AuthContext, permission: PermissionDef): void {
    if (permission.sensitive && !ctx.has('role:manage:sensitive')) {
      throw AppErrors.sensitivePermission(
        `Granting '${permission.key}' requires role:manage:sensitive`,
      );
    }
  }

  assertGrantable(ctx: AuthContext, key: string, scope: string): PermissionDef {
    const permission = this.assertPermissionExists(key);
    this.assertValidScope(permission, scope);
    this.assertCanGrant(ctx, key);
    this.assertCanGrantSensitive(ctx, permission);
    return permission;
  }

  /**
   * Simulates the pending change (already applied to `tx`, not yet
   * committed) and re-resolves the ACTING user's own permissions through
   * that same transaction client. If they currently hold role:manage or
   * user:manage and the change would remove it, the transaction throws —
   * which aborts it, so nothing is persisted (403 SELF_LOCKOUT).
   */
  async assertNoSelfLockout(
    ctx: AuthContext,
    affectedUserId: string,
    tx: PrismaLike,
  ): Promise<void> {
    if (affectedUserId !== ctx.userId) return;

    const resulting = await this.resolver.resolve(ctx.userId, tx);
    for (const guard of ['role:manage', 'user:manage'] as const) {
      if (ctx.has(guard) && !resulting.has(guard)) {
        throw AppErrors.selfLockout(`This change would revoke '${guard}' from yourself`);
      }
    }
  }

  /**
   * At least one active user must hold Owner (01-stage1-plan.md §5.5.2).
   * Call within the same transaction as the removal, after it's applied,
   * so the count reflects the post-change state.
   */
  async assertNotLastOwner(tx: PrismaLike, tenantId: string, ownerRoleId: string): Promise<void> {
    // distinct on userId: a user holding Owner at more than one branch must
    // not count twice and mask that they're actually the last one.
    const owners = await tx.userRole.findMany({
      where: { roleId: ownerRoleId, appUser: { tenantId, status: 'active', deletedAt: null } },
      select: { userId: true },
      distinct: ['userId'],
    });
    if (owners.length === 0) {
      throw AppErrors.lastOwner();
    }
  }
}
