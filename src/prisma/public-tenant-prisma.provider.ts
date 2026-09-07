import { Injectable } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { forTenant, TenantScopedClient } from './tenant-extension';

/**
 * The tenant seam's second, deliberately narrow entry point: for routes
 * that legitimately have no JWT — today, only the public landing page
 * (src/landing/public-landing.controller.ts).
 *
 * TenantPrisma takes `tid` from the verified token and throws without one,
 * which is exactly right for every authenticated route and useless for an
 * anonymous one. The tempting alternative — inject PrismaService in the
 * public module and hand-write `where: { tenantId }` — is the mistake the
 * seam exists to prevent, and .eslintrc.js bans the import outright.
 *
 * So this provider lives in prisma/ with the rest of the seam, and gives
 * a public route exactly one thing: a tenant code (an opaque, checkable
 * value from an anonymous URL — never an id taken on trust) in, the same
 * `forTenant()`-wrapped client every authenticated request uses out. A
 * public handler still cannot reach a raw client, and cannot address a
 * tenant that does not exist or has been suspended.
 */
@Injectable()
export class PublicTenantPrisma {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Resolves an active tenant by its public code. Returns null rather than
   * throwing so the caller can choose the error its own API contract
   * promises — a public route should not leak whether a code exists.
   */
  async byCode(code: string): Promise<{ tenantId: string; db: TenantScopedClient } | null> {
    const tenant = await this.prisma.tenant.findFirst({
      where: { code, status: 'active' },
      select: { id: true },
    });
    if (!tenant) return null;
    return { tenantId: tenant.id, db: forTenant(this.prisma, tenant.id) };
  }
}
