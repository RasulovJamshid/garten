export interface EnrollmentWindow {
  start: string;
  end: string;
}

interface StatusChange {
  oldStatus: string | null;
  newStatus: string;
  effectiveDate: Date;
}

/** Inclusive enrollment episodes; temporary absence and suspension do not end enrollment. */
export function enrollmentWindows(
  periodStart: Date,
  periodEnd: Date,
  child: { enrollmentDate: Date | null; withdrawalDate: Date | null },
  history: StatusChange[],
  firstTariffDate: Date | null,
): EnrollmentWindow[] {
  const lastDay = new Date(periodEnd.getTime() - 86400000);
  const enrolled = (status: string | null) =>
    ['active', 'temporarily_absent', 'suspended'].includes(status ?? '');
  const changes = [...history].sort(
    (a, b) => a.effectiveDate.getTime() - b.effectiveDate.getTime(),
  );
  const earliest = [child.enrollmentDate, firstTariffDate, changes[0]?.effectiveDate].filter(
    (value): value is Date => Boolean(value),
  );
  let start: Date | null = changes.length
    ? enrolled(changes[0].oldStatus)
      ? new Date(Math.min(...earliest.map((d) => d.getTime())))
      : null
    : (child.enrollmentDate ?? periodStart);
  const intervals: { start: Date; end: Date }[] = [];
  for (const change of changes) {
    if (enrolled(change.newStatus) && !start) start = change.effectiveDate;
    if (!enrolled(change.newStatus) && start) {
      intervals.push({ start, end: change.effectiveDate });
      start = null;
    }
  }
  if (start)
    intervals.push({ start, end: changes.length ? lastDay : (child.withdrawalDate ?? lastDay) });
  const clipped = intervals
    .map((w) => ({
      start: Math.max(w.start.getTime(), periodStart.getTime()),
      end: Math.min(w.end.getTime(), lastDay.getTime()),
    }))
    .filter((w) => w.start <= w.end)
    .sort((a, b) => a.start - b.start);
  const merged: typeof clipped = [];
  for (const interval of clipped) {
    const previous = merged.at(-1);
    if (previous && interval.start <= previous.end + 86400000)
      previous.end = Math.max(previous.end, interval.end);
    else merged.push({ ...interval });
  }
  return merged.map((w) => ({
    start: new Date(w.start).toISOString(),
    end: new Date(w.end).toISOString(),
  }));
}
