import { andWhere } from './prisma-where';

describe('andWhere', () => {
  it('keeps a scope clause and a filter that target the same key', () => {
    // The children bug: own_group scope and ?groupId= both want
    // `groupAssignment`, and assignment dropped the scope entirely.
    const scope = {
      groupAssignment: { some: { groupId: { in: ['g1', 'g2'] }, effectiveTo: null } },
    };
    const filter = { groupAssignment: { some: { groupId: 'g9', effectiveTo: null } } };

    const where = andWhere(andWhere({ deletedAt: null }, scope), filter);

    expect(where.AND).toEqual([scope, filter]);
    expect(where.deletedAt).toBeNull();
  });

  it('appends to an existing AND rather than replacing it', () => {
    const where = andWhere(andWhere({}, { a: 1 }), { b: 2 }, { c: 3 });
    expect(where.AND).toEqual([{ a: 1 }, { b: 2 }, { c: 3 }]);
  });

  it('absorbs a pre-existing non-array AND', () => {
    const where = andWhere({ AND: { a: 1 } }, { b: 2 });
    expect(where.AND).toEqual([{ a: 1 }, { b: 2 }]);
  });

  it('ignores undefined and empty clauses so an `all` scope adds nothing', () => {
    const base = { deletedAt: null };
    expect(andWhere(base, undefined, {})).toBe(base);
  });
});
