import { calculateCharge } from './calculate-charge';
import { DEFAULT_BILLING_RULES } from './default-billing-rules';
import { validateBillingRules } from './validate-billing-rules';
import { timestampRange } from '../common/tashkent-date';

describe('billing policy integrity', () => {
  const input = {
    baseTiyin: 10000n,
    kind: 'monthly_fixed' as const,
    billableDays: 20,
    attendedDays: 10,
    workingDays: 5,
    fixedDiscountsTiyin: [2000n],
    percentDiscountsBp: [],
  };
  it('applies fixed discounts before attendance only when configured', () => {
    const rules = structuredClone(DEFAULT_BILLING_RULES);
    expect(calculateCharge(input, rules).amountTiyin).toBe(3000n);
    rules.discount.applyBeforeAttendance = true;
    expect(calculateCharge(input, rules).amountTiyin).toBe(4000n);
  });
  it('uses working days for working-day tariffs and applies full-month policy', () => {
    const rules = structuredClone(DEFAULT_BILLING_RULES);
    rules.attendanceByKind.monthly_fixed = 'per_working_day';
    expect(calculateCharge(input, rules).amountTiyin).toBe(500n);
    expect(calculateCharge({ ...input, forceFullTariff: true }, rules).amountTiyin).toBe(8000n);
  });
  it.each([
    { ...DEFAULT_BILLING_RULES, billingTiming: 'advance' },
    {
      ...DEFAULT_BILLING_RULES,
      attendance: { ...DEFAULT_BILLING_RULES.attendance, fixedDivisor: 0 },
    },
    {
      ...DEFAULT_BILLING_RULES,
      discount: { ...DEFAULT_BILLING_RULES.discount, order: ['fixed', 'fixed'] },
    },
  ])('rejects invalid or unsupported rules', (rules) =>
    expect(() => validateBillingRules(rules)).toThrow(),
  );
  it('includes the entire Tashkent day in timestamp filters', () => {
    expect(timestampRange('2026-09-11', '2026-09-11')).toEqual({
      gte: new Date('2026-09-10T19:00:00Z'),
      lt: new Date('2026-09-11T19:00:00Z'),
    });
  });
});
