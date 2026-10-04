import { AsyncLocalStorage } from 'node:async_hooks';
import { Inject, Injectable, Scope } from '@nestjs/common';
import { REQUEST } from '@nestjs/core';
import { AuthenticatedRequest } from '../common/request-context';
import { AppErrors } from '../common/exceptions/app.exception';
import { PrismaService } from './prisma.service';
import { forTenant, TenantScopedClient } from './tenant-extension';
import { todayInTashkent } from '../common/tashkent-date';

/**
 * The ONLY database handle domain modules are allowed to inject.
 * `tid` comes exclusively from the verified JWT on the request — never
 * from a body, query, or header (kindergarten-docs api-spec §2, Auth).
 *
 * Lazy by design: merely injecting TenantPrisma must never throw. Several
 * @Public() routes (login, health) — and controllers like AuthController
 * that mix public and authenticated handlers in one class — get this
 * provider constructed for every request regardless of whether that
 * request is authenticated. Only accessing `.db`/`.tenantId` without a
 * verified tenant should fail, and only for the handler that actually
 * touches it.
 */
@Injectable({ scope: Scope.REQUEST })
export class TenantPrisma {
  constructor(
    @Inject(REQUEST) private readonly req: AuthenticatedRequest,
    private readonly prisma: PrismaService,
  ) {}

  private readonly transactionContext = new AsyncLocalStorage<any>();

  async transaction<T>(work: () => Promise<T>): Promise<T> {
    if (this.transactionContext.getStore()) return work();
    return this.db.$transaction(
      async (tx) => {
        const nested = new Proxy(tx, {
          get(target, property) {
            if (property === '$transaction')
              return async (arg: any) =>
                typeof arg === 'function' ? arg(nested) : Promise.all(arg);
            return Reflect.get(target, property);
          },
        });
        return this.transactionContext.run(nested, work);
      },
      { timeout: 120000 },
    );
  }

  private cachedDb?: TenantScopedClient;

  get tenantId(): string {
    if (!this.req.user?.tid) {
      throw AppErrors.unauthenticated('No tenant on request');
    }
    return this.req.user.tid;
  }

  get db(): TenantScopedClient {
    // Memoized per request — cheap, but no reason to re-wrap on every access.
    return (
      this.transactionContext.getStore() ??
      (this.cachedDb ??= forTenant(this.prisma, this.tenantId))
    );
  }

  get context() {
    if (!this.req.authContext) throw AppErrors.unauthenticated();
    return this.req.authContext;
  }

  branchWhere(permission: string): Record<string, any> {
    const ctx = this.context;
    const scope = ctx.scopeFor(permission);
    if (!scope) throw AppErrors.forbidden(`Missing permission: ${permission}`);
    if (scope === 'all') return {};
    return { branchId: { in: ctx.requireBranchIds(permission) } };
  }

  childWhere(permission: string, date = todayInTashkent()): Record<string, any> {
    const ctx = this.context;
    const scope = ctx.scopeFor(permission);
    if (!scope) throw AppErrors.forbidden(`Missing permission: ${permission}`);
    if (scope === 'all') return {};
    if (scope === 'own_group') {
      const at = new Date(date);
      return {
        branchId: { in: ctx.requireBranchIds(permission) },
        groupAssignment: {
          some: {
            groupId: { in: ctx.requireOwnGroupIds() },
            effectiveFrom: { lte: at },
            OR: [{ effectiveTo: null }, { effectiveTo: { gte: at } }],
          },
        },
      };
    }
    return { branchId: { in: ctx.requireBranchIds(permission) } };
  }

  async assertChild(id: string, permission: string, db: any = this.db, date?: string) {
    const child = await db.child.findFirst({
      where: { AND: [{ id, deletedAt: null }, this.childWhere(permission, date)] },
    });
    if (!child) throw AppErrors.notFound('Child not found');
    return child;
  }

  async assertBranch(id: string, permission: string, db: any = this.db) {
    const scope = this.context.scopeFor(permission);
    if (!scope) throw AppErrors.forbidden(`Missing permission: ${permission}`);
    if (scope !== 'all' && !this.context.requireBranchIds(permission).includes(id)) {
      throw AppErrors.outOfScope();
    }
    const branch = await db.branch.findFirst({ where: { id, deletedAt: null, status: 'active' } });
    if (!branch) throw AppErrors.notFound('Branch not found');
    return branch;
  }
}
