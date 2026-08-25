const UNIT_MS: Record<string, number> = {
  s: 1000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
};

/** Parses '15m', '30d', '1h' style durations (JWT_ACCESS_TTL / JWT_REFRESH_TTL) into milliseconds. */
export function parseDurationMs(value: string): number {
  const match = /^(\d+)([smhd])$/.exec(value.trim());
  if (!match) throw new Error(`Invalid duration '${value}' — expected e.g. '15m', '30d'`);
  return Number(match[1]) * UNIT_MS[match[2]];
}
