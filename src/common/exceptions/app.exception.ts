import { HttpException } from '@nestjs/common';

/**
 * Every domain error the API returns. `code` is the contract clients
 * localize from; `message` is English debug text only
 * (kindergarten-docs api-spec §2, Errors).
 */
export class AppException extends HttpException {
  constructor(
    public readonly code: string,
    message: string,
    httpStatus: number,
    public readonly details?: unknown,
  ) {
    super({ code, message, details }, httpStatus);
  }
}

// The registry from kindergarten-docs/docs/06-ops-reference.md §2 — one
// factory per code keeps the HTTP status pinned to the code everywhere
// it's thrown instead of being re-decided ad hoc at each call site.
export const AppErrors = {
  unauthenticated: (message = 'Missing or invalid token') =>
    new AppException('UNAUTHENTICATED', message, 401),
  tokenExpired: (message = 'Access token expired') =>
    new AppException('TOKEN_EXPIRED', message, 401),
  accountLocked: (message = 'Too many failed attempts') =>
    new AppException('ACCOUNT_LOCKED', message, 423),
  accountInactive: (message = 'User deactivated') =>
    new AppException('ACCOUNT_INACTIVE', message, 403),
  forbidden: (message = 'You do not have permission to perform this action') =>
    new AppException('FORBIDDEN', message, 403),
  outOfScope: (message = 'Record is outside your permission scope') =>
    new AppException('OUT_OF_SCOPE', message, 403),
  roleProtected: (message = 'Owner role cannot be modified or deleted') =>
    new AppException('ROLE_PROTECTED', message, 403),
  roleInUse: (message = 'Users still hold this role; reassign first') =>
    new AppException('ROLE_IN_USE', message, 409),
  lastOwner: (message = 'Cannot remove the final active Owner') =>
    new AppException('LAST_OWNER', message, 409),
  selfLockout: (message = 'Cannot revoke role:manage/user:manage from yourself') =>
    new AppException('SELF_LOCKOUT', message, 403),
  privilegeEscalation: (message = 'Cannot grant a permission you do not hold') =>
    new AppException('PRIVILEGE_ESCALATION', message, 403),
  sensitivePermission: (message = 'Requires role:manage:sensitive') =>
    new AppException('SENSITIVE_PERMISSION', message, 403),
  unknownPermission: (message = 'Permission key not in the code catalog') =>
    new AppException('UNKNOWN_PERMISSION', message, 400),
  invalidScope: (message = 'Scope not allowed for that permission') =>
    new AppException('INVALID_SCOPE', message, 400),

  validationFailed: (details?: unknown) =>
    new AppException('VALIDATION_FAILED', 'One or more fields are invalid', 422, details),
  notFound: (message = 'Resource not found') => new AppException('NOT_FOUND', message, 404),
  duplicate: (message = 'Resource already exists', details?: unknown) =>
    new AppException('DUPLICATE', message, 409, details),
  periodClosed: (message = 'Accounting period is closed') =>
    new AppException('PERIOD_CLOSED', message, 409),
  billingAlreadyCommitted: (message = 'Billing run already committed for this period') =>
    new AppException('BILLING_ALREADY_COMMITTED', message, 409),
  conflict: (message = 'Conflicting state') => new AppException('CONFLICT', message, 409),
} as const;
