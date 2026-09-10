/**
 * Combines a scope clause with caller-supplied filters without either
 * one clobbering the other.
 *
 * The bug this exists to prevent: scoping and filtering often want the
 * same Prisma key. `own_group` scope on children compiles to
 * `groupAssignment: { some: { groupId: { in: ownGroupIds } } }`, and a
 * `?groupId=` filter wants `groupAssignment` too — so a plain
 * `where.groupAssignment = ...` silently *replaces* the scope and hands
 * a teacher every group in the tenant. Spreading into `AND` keeps both
 * clauses, so a filter can only ever narrow what the scope allowed.
 */
export type Where = Record<string, unknown>;

export function andWhere(where: Where, ...clauses: (Where | undefined)[]): Where {
  const existing = Array.isArray(where.AND)
    ? (where.AND as Where[])
    : where.AND
      ? [where.AND as Where]
      : [];

  const added = clauses.filter((c): c is Where => !!c && Object.keys(c).length > 0);
  if (added.length === 0) return where;

  return { ...where, AND: [...existing, ...added] };
}
