import { Injectable } from '@nestjs/common';
import { AppErrors } from '../common/exceptions/app.exception';
import { AuthContext } from '../common/auth-context';
import { todayInTashkent } from '../common/tashkent-date';

export interface ScopeFields {
  /** Column that carries the branch id on the target table. Default 'branchId'. */
  branchField?: string;
  /** Column that carries the group id, for own_group scoping. Default 'groupId'. */
  ownGroupField?: string;
  /** Date column to restrict to today, for 'today' scope (e.g. attendance). */
  todayField?: string;
}

/**
 * A scope is meaningless unless it narrows the actual database query
 * (01-stage1-plan.md §5.3). Every list/read endpoint should run its Prisma
 * `where` through this before querying — a teacher guessing a child's UUID
 * outside their own_group gets 404, not the record.
 *
 * Usage:
 *   const where = this.scope.apply(ctx, 'child:read', {}, { ownGroupField: 'groupId' });
 *   return this.tenantPrisma.db.child.findMany({ where });
 */
@Injectable()
export class ScopeService {
  apply<W extends Record<string, unknown>>(
    ctx: AuthContext,
    permissionKey: string,
    where: W,
    fields: ScopeFields = {},
  ): W {
    const scope = ctx.scopeFor(permissionKey);
    if (!scope) {
      throw AppErrors.forbidden(`Missing permission: ${permissionKey}`);
    }

    switch (scope) {
      case 'all':
        return where;

      case 'branch': {
        const field = fields.branchField ?? 'branchId';
        return { ...where, [field]: { in: ctx.branchIds } };
      }

      case 'own_group': {
        const field = fields.ownGroupField ?? 'groupId';
        return { ...where, [field]: { in: ctx.ownGroupIds } };
      }

      case 'today': {
        const field = fields.todayField;
        if (!field) {
          throw AppErrors.invalidScope(
            `Permission '${permissionKey}' has no 'today' field configured`,
          );
        }
        return { ...where, [field]: todayInTashkent() };
      }

      case 'self':
        return { ...where, userId: ctx.userId };

      default:
        throw AppErrors.invalidScope(`Unknown scope '${scope}' for '${permissionKey}'`);
    }
  }
}
