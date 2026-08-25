const TIMEZONE = 'Asia/Tashkent';

/**
 * "Which day is this" must be computed in Asia/Tashkent, not UTC/server
 * time, or a 03:00 UTC event lands on the wrong calendar date
 * (01-stage1-plan.md §3.7). Returns YYYY-MM-DD.
 */
export function todayInTashkent(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

/** Current wall-clock time in Asia/Tashkent as { hour, minute }, DST-safe (there is none in UZ, but no toLocaleString round-trip hacks either). */
export function currentTimeInTashkent(now: Date = new Date()): { hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: TIMEZONE,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(now);
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? '0');
  const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? '0');
  return { hour, minute };
}
