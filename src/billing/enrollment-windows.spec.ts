import { enrollmentWindows } from './enrollment-windows';

const date = (day: string) => new Date(day);
const start = date('2026-09-01'),
  end = date('2026-10-01');
const change = (oldStatus: string, newStatus: string, day: string) => ({
  oldStatus,
  newStatus,
  effectiveDate: date(day),
});
describe('historical enrollment windows', () => {
  it('uses enrollment and withdrawal dates for legacy records without history', () => {
    expect(
      enrollmentWindows(
        start,
        end,
        { enrollmentDate: date('2026-09-05'), withdrawalDate: date('2026-09-10') },
        [],
        null,
      ),
    ).toEqual([{ start: date('2026-09-05').toISOString(), end: date('2026-09-10').toISOString() }]);
  });
  it('preserves both intervals after the child enrollment date is overwritten', () => {
    expect(
      enrollmentWindows(
        start,
        end,
        { enrollmentDate: date('2026-09-20'), withdrawalDate: null },
        [change('active', 'withdrawn', '2026-09-10'), change('withdrawn', 'active', '2026-09-20')],
        start,
      ),
    ).toEqual([
      { start: start.toISOString(), end: date('2026-09-10').toISOString() },
      { start: date('2026-09-20').toISOString(), end: date('2026-09-30').toISOString() },
    ]);
  });
  it('keeps an earlier month stable after a later reactivation', () => {
    expect(
      enrollmentWindows(
        start,
        end,
        { enrollmentDate: date('2026-10-02'), withdrawalDate: null },
        [change('active', 'withdrawn', '2026-09-10'), change('withdrawn', 'active', '2026-10-02')],
        start,
      ),
    ).toEqual([{ start: start.toISOString(), end: date('2026-09-10').toISOString() }]);
  });
  it('does not bill the gap between withdrawal and return', () => {
    const windows = enrollmentWindows(
      start,
      end,
      { enrollmentDate: date('2026-09-20'), withdrawalDate: null },
      [
        change('applicant', 'active', '2026-09-01'),
        change('active', 'withdrawn', '2026-09-10'),
        change('withdrawn', 'active', '2026-09-20'),
      ],
      start,
    );
    expect(
      windows.some((w) => date(w.start) <= date('2026-09-15') && date(w.end) >= date('2026-09-15')),
    ).toBe(false);
  });
  it('merges touching episodes and does not end enrollment for temporary absence', () => {
    expect(
      enrollmentWindows(
        start,
        end,
        { enrollmentDate: start, withdrawalDate: null },
        [
          change('active', 'temporarily_absent', '2026-09-04'),
          change('temporarily_absent', 'active', '2026-09-06'),
          change('active', 'withdrawn', '2026-09-10'),
          change('withdrawn', 'active', '2026-09-10'),
        ],
        start,
      ),
    ).toEqual([{ start: start.toISOString(), end: date('2026-09-30').toISOString() }]);
  });
});
