export type PermissionScope = 'all' | 'branch' | 'own_group' | 'today' | 'self';

const SCOPE_BREADTH: Record<PermissionScope, number> = {
  all: 4,
  branch: 3,
  own_group: 2,
  today: 1,
  self: 0,
};

/** Broader scope wins when a user holds the same permission via two roles. */
export function broaderScope(a: PermissionScope, b: PermissionScope): PermissionScope {
  return SCOPE_BREADTH[a] >= SCOPE_BREADTH[b] ? a : b;
}

/**
 * The resolved, request-scoped view of "what can this user do right now."
 * Built once per request by the PermissionGuard from the versioned cache;
 * everything downstream (controllers, ScopeService) reads from this rather
 * than re-querying roles.
 */
export class AuthContext {
  constructor(
    public readonly userId: string,
    public readonly tenantId: string,
    public readonly branchIds: string[],
    public readonly ownGroupIds: string[],
    private readonly permissions: ReadonlyMap<string, PermissionScope>,
  ) {}

  has(key: string): boolean {
    return this.permissions.has(key);
  }

  scopeFor(key: string): PermissionScope | undefined {
    return this.permissions.get(key);
  }

  requireScope(key: string): PermissionScope {
    const scope = this.permissions.get(key);
    if (!scope) {
      throw new Error(`AuthContext.requireScope('${key}') called without holding the permission`);
    }
    return scope;
  }

  toJSON(): Record<string, PermissionScope> {
    return Object.fromEntries(this.permissions);
  }
}
