import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PERMISSION_CATALOG } from './permission-catalog';

/**
 * Syncs the code catalog into the `permission` table on every boot.
 * New permissions appear granted to nobody (fail-closed). Permissions
 * removed from code are marked deprecated, never deleted, so audit
 * history referencing them stays readable (01-stage1-plan.md §5.1).
 */
@Injectable()
export class PermissionCatalogSyncService implements OnApplicationBootstrap {
  private readonly logger = new Logger(PermissionCatalogSyncService.name);

  constructor(private readonly prisma: PrismaService) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.sync();
  }

  async sync(): Promise<void> {
    const codeKeys = new Set(PERMISSION_CATALOG.map((p) => p.key));

    await this.prisma.$transaction(async (tx) => {
      for (const perm of PERMISSION_CATALOG) {
        await tx.permission.upsert({
          where: { key: perm.key },
          create: {
            key: perm.key,
            permGroup: perm.group,
            descriptionUz: perm.descriptionUz,
            descriptionRu: perm.descriptionRu,
            allowedScopes: [...perm.scopes],
            sensitive: perm.sensitive ?? false,
            deprecated: false,
          },
          update: {
            permGroup: perm.group,
            descriptionUz: perm.descriptionUz,
            descriptionRu: perm.descriptionRu,
            allowedScopes: [...perm.scopes],
            sensitive: perm.sensitive ?? false,
            deprecated: false,
            syncedAt: new Date(),
          },
        });
      }

      const existing = await tx.permission.findMany({ select: { key: true, deprecated: true } });
      const toDeprecate = existing
        .filter((p) => !codeKeys.has(p.key) && !p.deprecated)
        .map((p) => p.key);

      if (toDeprecate.length > 0) {
        await tx.permission.updateMany({
          where: { key: { in: toDeprecate } },
          data: { deprecated: true },
        });
        this.logger.warn(
          `Deprecated ${toDeprecate.length} permission(s) no longer in code: ${toDeprecate.join(', ')}`,
        );
      }
    });

    this.logger.log(`Permission catalog synced: ${PERMISSION_CATALOG.length} keys`);
    await this.warnAboutUngrantedKeys();
  }

  /**
   * Fail-closed is right, silent is not. A key that no role holds is
   * unreachable for every user in the tenant — the landing CMS shipped
   * that way and every /landing route answered 403 for weeks, Owner
   * included, because nothing said so out loud. A new permission is
   * expected to appear here once, then disappear as soon as an admin
   * grants it or a backfill migration does.
   */
  private async warnAboutUngrantedKeys(): Promise<void> {
    const granted = await this.prisma.rolePermission.findMany({
      distinct: ['permissionKey'],
      select: { permissionKey: true },
    });
    const held = new Set(granted.map((g) => g.permissionKey));
    const ungranted = PERMISSION_CATALOG.map((p) => p.key).filter((k) => !held.has(k));

    if (ungranted.length > 0) {
      this.logger.warn(
        `${ungranted.length} permission(s) are granted to no role in any tenant — every endpoint ` +
          `behind them returns 403 for everyone: ${ungranted.join(', ')}`,
      );
    }
  }
}
