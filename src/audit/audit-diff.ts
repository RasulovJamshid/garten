/** Shallow before/after diff: { field: [oldValue, newValue] } for changed keys only. */
export function computeDiff(
  oldValue?: Record<string, unknown>,
  newValue?: Record<string, unknown>,
): Record<string, [unknown, unknown]> | undefined {
  if (!oldValue || !newValue) return undefined;

  const diff: Record<string, [unknown, unknown]> = {};
  const keys = new Set([...Object.keys(oldValue), ...Object.keys(newValue)]);
  for (const key of keys) {
    // `undefined` (key present in only one side) must not reach the JSONB
    // column — Prisma's input validator rejects `undefined` inside a JSON
    // value array, so normalize to `null` (a real JSON value) instead.
    const before = oldValue[key] ?? null;
    const after = newValue[key] ?? null;
    if (JSON.stringify(before) !== JSON.stringify(after)) {
      diff[key] = [before, after];
    }
  }
  return diff;
}
