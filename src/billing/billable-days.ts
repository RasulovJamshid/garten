import { BillingRules } from './billing-rules.types';

/** ISO weekday, 1=Mon..7=Sun, matching `setting.workingDays`. */
function isoWeekday(date: Date): number {
  const day = date.getUTCDay(); // 0=Sun..6=Sat
  return day === 0 ? 7 : day;
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * Working days in a calendar month, respecting `setting.workingDays` and
 * the holiday table (a `holiday.isWorking = true` row is a working
 * Saturday override — it ADDS the day back in even though the weekday
 * isn't normally a working day).
 */
export function workingDaysInMonth(
  year: number,
  month: number,
  workingDaysOfWeek: number[],
  holidayDates: Set<string>, // 'YYYY-MM-DD', non-working holidays
  workingOverrideDates: Set<string>, // 'YYYY-MM-DD', working-day overrides (e.g. a made-up Saturday)
): number {
  const total = daysInMonth(year, month);
  let count = 0;
  for (let d = 1; d <= total; d++) {
    const date = new Date(Date.UTC(year, month - 1, d));
    const iso = date.toISOString().slice(0, 10);
    const isNormallyWorking = workingDaysOfWeek.includes(isoWeekday(date));
    const isHoliday = holidayDates.has(iso);
    const isOverride = workingOverrideDates.has(iso);

    if (isOverride) count++;
    else if (isNormallyWorking && !isHoliday) count++;
  }
  return count;
}

/**
 * Working days that intersect a child's enrollment window within the
 * month — this is what makes mid-month enrollment/withdrawal proration
 * automatic, no separate code path (03-billing-rules.md §5).
 */
export function billableDaysInWindow(
  year: number,
  month: number,
  workingDaysOfWeek: number[],
  holidayDates: Set<string>,
  workingOverrideDates: Set<string>,
  windowStart: Date | null,
  windowEnd: Date | null,
): number {
  const total = daysInMonth(year, month);
  let count = 0;
  for (let d = 1; d <= total; d++) {
    const date = new Date(Date.UTC(year, month - 1, d));
    if (windowStart && date < windowStart) continue;
    if (windowEnd && date > windowEnd) continue;

    const iso = date.toISOString().slice(0, 10);
    const isNormallyWorking = workingDaysOfWeek.includes(isoWeekday(date));
    const isHoliday = holidayDates.has(iso);
    const isOverride = workingOverrideDates.has(iso);

    if (isOverride) count++;
    else if (isNormallyWorking && !isHoliday) count++;
  }
  return count;
}

export function resolveBillableDays(
  rules: BillingRules,
  year: number,
  month: number,
  workingDaysOfWeek: number[],
  holidayDates: Set<string>,
  workingOverrideDates: Set<string>,
  enrollmentWindow: { start: Date | null; end: Date | null } | null,
): number {
  if (rules.attendance.divisor === 'fixed') return rules.attendance.fixedDivisor;
  if (rules.attendance.divisor === 'calendar_days') return daysInMonth(year, month);

  if (rules.proration.divisorRespectsEnrollmentWindow && enrollmentWindow) {
    return billableDaysInWindow(
      year,
      month,
      workingDaysOfWeek,
      holidayDates,
      workingOverrideDates,
      enrollmentWindow.start,
      enrollmentWindow.end,
    );
  }

  return workingDaysInMonth(year, month, workingDaysOfWeek, holidayDates, workingOverrideDates);
}
