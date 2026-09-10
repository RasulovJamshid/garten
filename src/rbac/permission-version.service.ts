import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * PermissionCacheService keys entries `${userId}:${permissionsVersion}`,
 * so the ONLY thing that makes a stale entry unreachable is bumping the
 * tenant's permissionsVersion (permission-cache.service.ts). Nothing was
 * calling it: a freshly granted permission stayed invisible until the
 * 60s LRU TTL expired, which reads to an admin as "I granted it and it
 * did nothing".
 *
 * Every write that can change what a user resolves to must call this:
 * role grants/revokes, role deletion, user↔role assignment, per-user
 * overrides, branch attachment, activation/deactivation.
 */
@Injectable()
export class PermissionVersionService {
  private readonly logger = new Logger(PermissionVersionService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Deliberately best-effort: the RBAC write it follows is already
   * committed and authoritative. Failing the request after that point
   * would report a mutation as failed when it actually happened — the
   * worst outcome is a stale cache that expires within 60s anyway.
   */
  async bump(tenantId: string): Promise<void> {
    try {
      await this.prisma.tenant.update({
        where: { id: tenantId },
        data: { permissionsVersion: { increment: 1 } },
      });
    } catch (e) {
      this.logger.error(
        `Failed to bump permissionsVersion for tenant ${tenantId}: ${(e as Error).message}`,
      );
    }
  }
}
