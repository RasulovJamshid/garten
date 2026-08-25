import { Module } from '@nestjs/common';
import { PermissionCatalogSyncService } from './permission-catalog-sync.service';
import { PermissionResolverService } from './permission-resolver.service';
import { PermissionCacheService } from './permission-cache.service';
import { PermissionGuard } from './permission.guard';
import { ScopeService } from './scope.service';
import { RbacSafetyService } from './rbac-safety.service';
import { PermissionsController } from './permissions.controller';

/**
 * PermissionGuard is exported, NOT registered as APP_GUARD here — it MUST
 * run strictly after JwtAuthGuard (it reads req.user, which JwtAuthGuard
 * sets). Global guard order is registration order, so both are wired
 * together, explicitly, in AppModule instead of relying on module import
 * order across two modules.
 */
@Module({
  controllers: [PermissionsController],
  providers: [
    PermissionCatalogSyncService,
    PermissionResolverService,
    PermissionCacheService,
    ScopeService,
    RbacSafetyService,
    PermissionGuard,
  ],
  exports: [
    ScopeService,
    PermissionCacheService,
    PermissionResolverService,
    RbacSafetyService,
    PermissionGuard,
  ],
})
export class RbacModule {}
