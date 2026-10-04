import { AuthContext, PermissionScope } from '../common/auth-context';
import { branchLookupWhere, groupLookupWhere } from './lookup-scope';
import { PermissionResolverService } from './permission-resolver.service';

describe('Scoped bootstrap lookups', () => {
  const context = (grants: [string, PermissionScope][], branches?: Map<string, string[]>) =>
    new AuthContext('user', 'tenant', ['A', 'B'], ['own'], new Map(grants), branches);

  it('does not let an unrelated all-scoped permission widen teacher group labels', () => {
    const where = groupLookupWhere(
      context(
        [
          ['child:read', 'own_group'],
          ['report:read', 'all'],
        ],
        new Map([['child:read', ['A']]]),
      ),
    );
    expect(where).toEqual({
      deletedAt: null,
      OR: [{ branchId: { in: ['A'] }, id: { in: ['own'] } }],
    });
  });

  it('includes empty branches for global branch operations', () => {
    expect(branchLookupWhere(context([['branch:manage', 'all']]))).toEqual({ deletedAt: null });
    expect(branchLookupWhere(context([['expense:manage', 'all']]))).toEqual({ deletedAt: null });
    expect(branchLookupWhere(context([['report:read', 'all']]))).toEqual({
      deletedAt: null,
      id: { in: ['A', 'B'] },
    });
  });

  it('uses the branch footprint of each resource permission', () => {
    expect(
      groupLookupWhere(
        context([['attendance:read', 'branch']], new Map([['attendance:read', ['A']]])),
      ),
    ).toEqual({
      deletedAt: null,
      OR: [{ branchId: { in: ['A'] } }],
    });
  });

  it('allows global financial labels without granting child profile access', () => {
    expect(
      groupLookupWhere(
        context([
          ['child:read', 'branch'],
          ['payment:create', 'all'],
        ]),
      ),
    ).toEqual({ deletedAt: null });
  });

  it('returns an empty group predicate when no relevant permission exists', () => {
    expect(groupLookupWhere(context([['notification:send', 'all']]))).toEqual({
      deletedAt: null,
      OR: [],
    });
  });

  it('keeps unassigned users empty in bootstrap and fails scoped resource queries clearly', () => {
    const ctx = new AuthContext('user', 'tenant', [], [], new Map([['child:read', 'own_group']]));
    expect(groupLookupWhere(ctx)).toEqual({
      deletedAt: null,
      OR: [{ branchId: { in: [] }, id: { in: [] } }],
    });
    expect(() => ctx.requireOwnGroupIds()).toThrow();
  });

  it('checks staff assignment dates against the Tashkent calendar day', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-10-03T22:00:00Z'));
    try {
      const findMany = jest.fn().mockResolvedValue([{ groupId: 'own' }]);
      const resolver = new PermissionResolverService({ groupStaff: { findMany } } as any);
      expect(await resolver.ownGroupIds('user')).toEqual(['own']);
      expect(findMany).toHaveBeenCalledWith({
        where: {
          userId: 'user',
          assignedFrom: { lte: new Date('2026-10-04') },
          OR: [{ assignedTo: null }, { assignedTo: { gte: new Date('2026-10-04') } }],
        },
        select: { groupId: true },
      });
    } finally {
      jest.useRealTimers();
    }
  });
});
