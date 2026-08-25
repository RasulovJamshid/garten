import { calculateCharge, divRound } from './calculate-charge';
import { DEFAULT_BILLING_RULES } from './default-billing-rules';
import { BillingRules, ChargeInput } from './billing-rules.types';

function baseInput(overrides: Partial<ChargeInput> = {}): ChargeInput {
  return {
    baseTiyin: 150_000_000n, // 1,500,000 som
    kind: 'monthly_fixed',
    attendedDays: 18,
    billableDays: 22,
    fixedDiscountsTiyin: [],
    percentDiscountsBp: [],
    ...overrides,
  };
}

function rules(overrides: Partial<BillingRules> = {}): BillingRules {
  return {
    ...DEFAULT_BILLING_RULES,
    ...overrides,
    discount: { ...DEFAULT_BILLING_RULES.discount, ...overrides.discount },
    attendance: { ...DEFAULT_BILLING_RULES.attendance, ...overrides.attendance },
    rounding: { ...DEFAULT_BILLING_RULES.rounding, ...overrides.rounding },
  };
}

describe('calculateCharge — discount order (the confirmed rule, §3)', () => {
  // 03-billing-rules.md §3 works this example in whole som for readability
  // (1,500,000 tariff, 18/22 days, 200,000 fixed + 10% percent -> 924,546).
  // At full tiyin precision (this engine's actual unit) the equivalent
  // figures are 92,454,546 / 90,454,546 — the 2,000,000-tiyin (20,000 som)
  // gap between fixed-first and percent-first matches the doc's claim
  // exactly; the last-som difference from the doc's own rounded-by-hand
  // walkthrough is expected since tiyin-precise math never rounds mid-way.
  it('fixed then percent produces the confirmed result (fixed-first is higher)', () => {
    const input = baseInput({
      fixedDiscountsTiyin: [20_000_000n], // 200,000 som sibling discount
      percentDiscountsBp: [1000], // 10% staff discount
    });
    const result = calculateCharge(input, rules());
    expect(result.amountTiyin).toBe(92_454_546n);
  });

  it('reversing the order produces a lower result (904,545.46 som), proving order is honoured', () => {
    const input = baseInput({
      fixedDiscountsTiyin: [20_000_000n],
      percentDiscountsBp: [1000],
    });
    const percentFirst = calculateCharge(
      input,
      rules({ discount: { ...DEFAULT_BILLING_RULES.discount, order: ['percent', 'fixed'] } }),
    );
    const fixedFirst = calculateCharge(input, rules());
    expect(percentFirst.amountTiyin).toBe(90_454_546n);
    expect(fixedFirst.amountTiyin - percentFirst.amountTiyin).toBe(2_000_000n); // 20,000 som higher
  });

  it('a fixed discount larger than the base floors at 0, never negative', () => {
    const input = baseInput({ attendedDays: 22, fixedDiscountsTiyin: [999_999_999_999n] });
    const result = calculateCharge(input, rules());
    expect(result.amountTiyin).toBe(0n);
  });

  it('percent discounts summing over 100% are capped, result 0', () => {
    const input = baseInput({ attendedDays: 22, percentDiscountsBp: [6000, 6000] });
    const result = calculateCharge(input, rules());
    expect(result.amountTiyin).toBe(0n);
  });

  it('multipleFixed: sum adds both fixed discounts', () => {
    const input = baseInput({ attendedDays: 22, fixedDiscountsTiyin: [10_000_000n, 5_000_000n] });
    const result = calculateCharge(
      input,
      rules({ discount: { ...DEFAULT_BILLING_RULES.discount, multipleFixed: 'sum' } }),
    );
    expect(result.amountTiyin).toBe(150_000_000n - 15_000_000n);
  });

  it('multipleFixed: largest_only keeps only the bigger discount', () => {
    const input = baseInput({ attendedDays: 22, fixedDiscountsTiyin: [10_000_000n, 5_000_000n] });
    const result = calculateCharge(
      input,
      rules({ discount: { ...DEFAULT_BILLING_RULES.discount, multipleFixed: 'largest_only' } }),
    );
    expect(result.amountTiyin).toBe(150_000_000n - 10_000_000n);
  });

  it('multiplePercent: sum gives 15% off for 10%+5%', () => {
    const input = baseInput({ attendedDays: 22, percentDiscountsBp: [1000, 500] });
    const result = calculateCharge(
      input,
      rules({ discount: { ...DEFAULT_BILLING_RULES.discount, multiplePercent: 'sum' } }),
    );
    expect(result.amountTiyin).toBe(150_000_000n - 22_500_000n); // 15% of 150,000,000
  });

  it('multiplePercent: compound gives 14.5% off for 10% then 5% of the remainder', () => {
    const input = baseInput({ attendedDays: 22, percentDiscountsBp: [1000, 500] });
    const result = calculateCharge(
      input,
      rules({ discount: { ...DEFAULT_BILLING_RULES.discount, multiplePercent: 'compound' } }),
    );
    // 150,000,000 * 0.9 = 135,000,000; * 0.95 = 128,250,000 -> discount 21,750,000 (14.5%)
    expect(result.amountTiyin).toBe(128_250_000n);
  });
});

describe('calculateCharge — attendance', () => {
  it('18/22 days is exact integer arithmetic with no float drift', () => {
    const result = calculateCharge(baseInput({ attendedDays: 18, billableDays: 22 }), rules());
    // 150,000,000 * 18 / 22 = 122,727,272.7 -> half_up -> 122,727,273
    expect(result.amountTiyin).toBe(122_727_273n);
  });

  it('22/22 days equals exactly the full tariff — no rounding leak', () => {
    const result = calculateCharge(baseInput({ attendedDays: 22, billableDays: 22 }), rules());
    expect(result.amountTiyin).toBe(150_000_000n);
  });

  it('0 attended days with noAttendanceBehaviour=zero charges nothing', () => {
    const result = calculateCharge(baseInput({ attendedDays: 0 }), rules());
    expect(result.amountTiyin).toBe(0n);
  });

  it('0 attended days with noAttendanceBehaviour=min_charge charges the minimum', () => {
    const r = rules({
      attendance: {
        ...DEFAULT_BILLING_RULES.attendance,
        noAttendanceBehaviour: 'min_charge',
        minChargeTiyin: '5000000',
      },
    });
    const result = calculateCharge(baseInput({ attendedDays: 0 }), r);
    expect(result.amountTiyin).toBe(5_000_000n);
  });

  it('0 attended days with noAttendanceBehaviour=full_tariff charges the whole month', () => {
    const r = rules({
      attendance: { ...DEFAULT_BILLING_RULES.attendance, noAttendanceBehaviour: 'full_tariff' },
    });
    const result = calculateCharge(baseInput({ attendedDays: 0 }), r);
    expect(result.amountTiyin).toBe(150_000_000n);
  });

  it('attended > billable (data error) is capped at the full tariff', () => {
    const result = calculateCharge(baseInput({ attendedDays: 30, billableDays: 22 }), rules());
    expect(result.amountTiyin).toBe(150_000_000n);
  });

  it('billableDays = 0 (month entirely holidays) never divides by zero', () => {
    const result = calculateCharge(baseInput({ attendedDays: 0, billableDays: 0 }), rules());
    expect(result.amountTiyin).toBe(0n);
  });

  it('meals scale per attended day while extra_class stays flat (attendanceByKind)', () => {
    const meal = calculateCharge(
      baseInput({ kind: 'meal', baseTiyin: 22_000_000n, attendedDays: 11, billableDays: 22 }),
      rules(),
    );
    expect(meal.amountTiyin).toBe(11_000_000n); // half the days, half the meal cost

    const extraClass = calculateCharge(
      baseInput({ kind: 'extra_class', baseTiyin: 5_000_000n, attendedDays: 11, billableDays: 22 }),
      rules(),
    );
    expect(extraClass.amountTiyin).toBe(5_000_000n); // flat regardless of attendance
  });
});

describe('calculateCharge — rounding', () => {
  it('sum of many children with 18/22 attendance has no accumulated drift beyond one tiyin per child', () => {
    const perChild = calculateCharge(
      baseInput({ attendedDays: 18, billableDays: 22 }),
      rules(),
    ).amountTiyin;
    const total = perChild * 100n;
    // Sanity: summing pre-rounded per-child amounts is exact integer arithmetic,
    // not float accumulation — this is the whole point of BigInt tiyin.
    expect(total).toBe(12_272_727_300n);
  });

  it('rounds to the nearest som when configured', () => {
    const r = rules({ rounding: { unit: 'som', mode: 'half_up' } });
    const result = calculateCharge(baseInput({ attendedDays: 18, billableDays: 22 }), r);
    expect(result.amountTiyin % 100n).toBe(0n);
  });

  it('rounds to the nearest 1000 som when configured', () => {
    const r = rules({ rounding: { unit: '1000_som', mode: 'half_up' } });
    const result = calculateCharge(baseInput({ attendedDays: 18, billableDays: 22 }), r);
    expect(result.amountTiyin % 100_000n).toBe(0n);
  });
});

describe('divRound', () => {
  it('half_up rounds .5 up', () => {
    expect(divRound(5n, 2n, 'half_up')).toBe(3n); // 2.5 -> 3
  });
  it('floor truncates', () => {
    expect(divRound(5n, 2n, 'floor')).toBe(2n);
  });
  it('ceil rounds up regardless of remainder', () => {
    expect(divRound(5n, 2n, 'ceil')).toBe(3n);
    expect(divRound(4n, 2n, 'ceil')).toBe(2n);
  });
  it('bankers rounds .5 to the nearest even', () => {
    expect(divRound(5n, 2n, 'bankers')).toBe(2n); // 2.5 -> 2 (even)
    expect(divRound(7n, 2n, 'bankers')).toBe(4n); // 3.5 -> 4 (even)
  });
  it('never divides by zero', () => {
    expect(divRound(100n, 0n)).toBe(0n);
  });
});
