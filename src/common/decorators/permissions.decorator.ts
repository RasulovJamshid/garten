import { SetMetadata } from '@nestjs/common';
import { PermissionKey } from '../../rbac/permission-catalog';

export const PERMISSIONS_KEY = 'requiredPermissions';

/**
 * Declares the permission(s) an endpoint requires. This single declaration
 * also drives the generated /permissions documentation and the RBAC test
 * matrix (kindergarten-docs api-spec §3, "Every endpoint declares its
 * requirement").
 */
export const RequirePermissions = (...permissions: PermissionKey[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);
