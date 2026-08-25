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
  }
}
