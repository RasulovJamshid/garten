import { AuthContext, PermissionScope } from './auth-context';
import { AppException } from './exceptions/app.exception';

function ctx(branchIds: string[], ownGroupIds: string[]) {
  const perms = new Map<string, PermissionScope>([['child:read', 'own_group']]);
  return new AuthContext('u1', 't1', branchIds, ownGroupIds, perms);
}

describe('AuthContext scope assignment guards', () => {
  it('returns the ids when the user is actually assigned', () => {
    expect(ctx(['b1'], ['g1']).requireBranchIds()).toEqual(['b1']);
    expect(ctx(['b1'], ['g1']).requireOwnGroupIds()).toEqual(['g1']);
  });

  // The reported bug: a teacher who is not staff on any group resolved to
  // `groupId: { in: [] }` and got 200 + zero rows, indistinguishable from
  // "this kindergarten has no children".
  it('throws NO_SCOPE_ASSIGNMENT instead of matching nothing', () => {
    expect(() => ctx([], ['g1']).requireBranchIds()).toThrow(AppException);
    expect(() => ctx(['b1'], []).requireOwnGroupIds()).toThrow(AppException);

    try {
      ctx(['b1'], []).requireOwnGroupIds();
    } catch (e) {
      expect((e as AppException).code).toBe('NO_SCOPE_ASSIGNMENT');
      expect((e as AppException).getStatus()).toBe(403);
    }
  });
});
