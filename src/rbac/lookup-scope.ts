import { Prisma } from '@prisma/client';
import { AuthContext } from '../common/auth-context';

// Only permissions that operate on groups/children contribute group labels.
// An unrelated tenant-wide permission (for example report:read) cannot widen them.
const GROUP_LABEL_PERMISSIONS = [
  'group:read',
  'child:read',
  'attendance:read',
  'attendance:checkin',
  'attendance:checkout',
  'pickup:read',
  'pickup:manage',
  'pickup:temporary',
  'payment:read',
  'payment:create',
  'charge:read',
  'charge:generate',
  'billing_rules:manage',
  'medical:read',
  'medical:alerts',
];

export function branchLookupWhere(ctx: AuthContext): Prisma.BranchWhereInput {
  const keys = [
    ...GROUP_LABEL_PERMISSIONS,
    'branch:manage',
    'expense:read',
    'expense:manage',
    'holiday:manage',
    'user:manage',
  ];
  if (keys.some((key) => ctx.scopeFor(key) === 'all')) return { deletedAt: null };
  return { deletedAt: null, id: { in: ctx.branchIds } };
}

export function groupLookupWhere(ctx: AuthContext): Prisma.ChildGroupWhereInput {
  const alternatives: Prisma.ChildGroupWhereInput[] = [];
  for (const key of GROUP_LABEL_PERMISSIONS) {
    const scope = ctx.scopeFor(key);
    if (scope === 'all') return { deletedAt: null };
    if (scope === 'own_group') {
      alternatives.push({
        branchId: { in: ctx.accessibleBranchIds(key) },
        id: { in: ctx.ownGroupIds },
      });
    } else if (scope === 'branch' || scope === 'today') {
      alternatives.push({ branchId: { in: ctx.accessibleBranchIds(key) } });
    }
  }
  return { deletedAt: null, OR: alternatives };
}
