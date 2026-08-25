import { Inject, Injectable, Scope } from '@nestjs/common';
import { REQUEST } from '@nestjs/core';
import { AuthenticatedRequest } from '../common/request-context';
import { AppErrors } from '../common/exceptions/app.exception';
import { PrismaService } from './prisma.service';
import { forTenant, TenantScopedClient } from './tenant-extension';

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

  private cachedDb?: TenantScopedClient;

  get tenantId(): string {
    if (!this.req.user?.tid) {
      throw AppErrors.unauthenticated('No tenant on request');
    }
    return this.req.user.tid;
  }

  get db(): TenantScopedClient {
    // Memoized per request — cheap, but no reason to re-wrap on every access.
    return (this.cachedDb ??= forTenant(this.prisma, this.tenantId));
  }
}
