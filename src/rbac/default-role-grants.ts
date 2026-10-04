import { PERMISSION_CATALOG, PermissionKey } from './permission-catalog';

type Grant = { key: PermissionKey; scope: 'all' | 'branch' | 'own_group' | 'today' | 'self' };

const ALL_GRANTS: Grant[] = PERMISSION_CATALOG.map((p) => ({ key: p.key, scope: 'all' }));

// Default grants for the seeded system roles (01-stage1-plan.md §5.6).
// Fully editable afterwards via the roles API once it exists — these are
// starting templates, not hardcoded policy.
export const ROLE_GRANTS: Record<string, Grant[]> = {
  owner: ALL_GRANTS,

  director: PERMISSION_CATALOG.filter(
    (p) => !['period:reopen', 'role:manage:sensitive'].includes(p.key),
  ).map((p) => ({ key: p.key, scope: 'all' })),

  administrator: [
    { key: 'child:read', scope: 'all' },
    { key: 'child:create', scope: 'all' },
    { key: 'child:update', scope: 'all' },
    { key: 'child:status', scope: 'all' },
    { key: 'group:read', scope: 'all' },
    { key: 'group:manage', scope: 'all' },
    { key: 'guardian:read', scope: 'all' },
    { key: 'guardian:manage', scope: 'all' },
    { key: 'consent:read', scope: 'all' },
    { key: 'consent:manage', scope: 'all' },
    { key: 'user:manage', scope: 'all' },
    { key: 'role:manage', scope: 'all' },
    { key: 'settings:manage', scope: 'all' },
    // Both halves: an administrator already pushes announcements to every
    // parent, so publishing the website is not a step up in blast radius.
    // The manage/publish split earns its keep for a tenant-defined
    // "content editor" role that should draft but not go live.
    { key: 'landing:manage', scope: 'all' },
    { key: 'landing:publish', scope: 'all' },
    { key: 'branch:manage', scope: 'all' },
    { key: 'holiday:manage', scope: 'all' },
    { key: 'announcement:manage', scope: 'all' },
    { key: 'notification:send', scope: 'all' },
    { key: 'notification_template:manage', scope: 'all' },
    { key: 'report:read', scope: 'all' },
    { key: 'dashboard:read', scope: 'all' },
    { key: 'file:read', scope: 'all' },
    { key: 'file:manage', scope: 'all' },
    { key: 'attendance:read', scope: 'all' },
    { key: 'attendance:checkin', scope: 'all' },
    { key: 'attendance:checkout', scope: 'all' },
    { key: 'attendance:correct', scope: 'all' },
    { key: 'pickup:read', scope: 'all' },
    { key: 'pickup:manage', scope: 'all' },
    { key: 'pickup:temporary', scope: 'all' },
    { key: 'medical:alerts', scope: 'all' },
  ],

  accountant: [
    { key: 'child:read', scope: 'branch' },
    { key: 'guardian:read', scope: 'branch' },
    { key: 'tariff:manage', scope: 'all' },
    { key: 'charge:read', scope: 'all' },
    { key: 'charge:generate', scope: 'all' },
    { key: 'charge:reverse', scope: 'all' },
    { key: 'payment:read', scope: 'all' },
    { key: 'payment:create', scope: 'all' },
    { key: 'payment:cancel', scope: 'all' },
    { key: 'discount:manage', scope: 'all' },
    { key: 'period:close', scope: 'all' },
    { key: 'debt:read', scope: 'all' },
    { key: 'billing_rules:manage', scope: 'all' },
    { key: 'expense:read', scope: 'all' },
    { key: 'expense:manage', scope: 'all' },
    { key: 'report:read', scope: 'all' },
    { key: 'dashboard:read', scope: 'all' },
    { key: 'import:manage', scope: 'all' },
    { key: 'file:read', scope: 'branch' },
    { key: 'file:manage', scope: 'all' },
  ],

  teacher: [
    { key: 'child:read', scope: 'own_group' },
    { key: 'medical:alerts', scope: 'own_group' },
    { key: 'attendance:read', scope: 'own_group' },
    { key: 'attendance:checkin', scope: 'own_group' },
    { key: 'attendance:checkout', scope: 'own_group' },
    { key: 'pickup:read', scope: 'own_group' },
    { key: 'file:read', scope: 'own_group' },
  ],

  reception: [
    { key: 'file:read', scope: 'branch' },
    { key: 'file:manage', scope: 'branch' },
    { key: 'child:read', scope: 'branch' },
    { key: 'guardian:read', scope: 'branch' },
    { key: 'attendance:read', scope: 'today' },
    { key: 'attendance:checkin', scope: 'branch' },
    { key: 'attendance:checkout', scope: 'branch' },
    { key: 'pickup:read', scope: 'branch' },
    { key: 'pickup:manage', scope: 'branch' },
    { key: 'pickup:temporary', scope: 'branch' },
  ],

  nurse: [
    { key: 'file:read', scope: 'branch' },
    { key: 'file:manage', scope: 'branch' },
    { key: 'child:read', scope: 'branch' },
    { key: 'medical:read', scope: 'branch' },
    { key: 'medical:write', scope: 'branch' },
    { key: 'medical:alerts', scope: 'branch' },
  ],
};
