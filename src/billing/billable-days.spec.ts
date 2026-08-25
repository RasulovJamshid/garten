import { billableDaysInWindow, daysInMonth, workingDaysInMonth } from './billable-days';

describe('workingDaysInMonth', () => {
  // July 2026: 1 Wed .. 31 Fri. Mon-Fri working days.
  it('counts Mon-Fri working days with no holidays', () => {
    const count = workingDaysInMonth(2026, 7, [1, 2, 3, 4, 5], new Set(), new Set());
    // July 2026 has 23 weekdays (31 days, 8 weekend days: 4,5,11,12,18,19,25,26)
    expect(count).toBe(23);
  });

  it('excludes a holiday that falls on a normally-working day', () => {
    const withoutHoliday = workingDaysInMonth(2026, 7, [1, 2, 3, 4, 5], new Set(), new Set());
    const withHoliday = workingDaysInMonth(
      2026,
      7,
      [1, 2, 3, 4, 5],
      new Set(['2026-07-01']),
      new Set(),
    );
    expect(withHoliday).toBe(withoutHoliday - 1);
  });

  it('a working-Saturday override adds the day back in', () => {
    const normal = workingDaysInMonth(2026, 7, [1, 2, 3, 4, 5], new Set(), new Set());
    const withOverride = workingDaysInMonth(
      2026,
      7,
      [1, 2, 3, 4, 5],
      new Set(),
      new Set(['2026-07-04']),
    ); // a Saturday
    expect(withOverride).toBe(normal + 1);
  });

  it('daysInMonth returns the correct length', () => {
    expect(daysInMonth(2026, 7)).toBe(31);
    expect(daysInMonth(2026, 2)).toBe(28);
    expect(daysInMonth(2024, 2)).toBe(29); // leap year
  });
});

describe('billableDaysInWindow — mid-month enrollment/withdrawal proration', () => {
  it('a child enrolled on the 14th only counts working days from the 14th', () => {
    const fullMonth = billableDaysInWindow(
      2026,
      7,
      [1, 2, 3, 4, 5],
      new Set(),
      new Set(),
      null,
      null,
    );
    const fromThe14th = billableDaysInWindow(
      2026,
      7,
      [1, 2, 3, 4, 5],
      new Set(),
      new Set(),
      new Date(Date.UTC(2026, 6, 14)),
      null,
    );
    expect(fromThe14th).toBeLessThan(fullMonth);
    expect(fromThe14th).toBeGreaterThan(0);
  });

  it('a child withdrawn on the 10th only counts working days up to the 10th', () => {
    const upToThe10th = billableDaysInWindow(
      2026,
      7,
      [1, 2, 3, 4, 5],
      new Set(),
      new Set(),
      null,
      new Date(Date.UTC(2026, 6, 10)),
    );
    const fullMonth = billableDaysInWindow(
      2026,
      7,
      [1, 2, 3, 4, 5],
      new Set(),
      new Set(),
      null,
      null,
    );
    expect(upToThe10th).toBeLessThan(fullMonth);
    expect(upToThe10th).toBeGreaterThan(0);
  });
});
