import {
  BillingRules,
  ChargeInput,
  ChargeResult,
  RoundingMode,
  TraceStep,
} from './billing-rules.types';

/**
 * Pure function, integer math only — no floats anywhere in the finance
 * path (03-billing-rules.md §4). `trace` is not optional: a parent will
 * ask why their bill is 924,546 and not 900,000, and the trace is what
 * answers that without a manual recomputation by hand.
 */

/** half-up (or floor/ceil) division for positive bigints. */
export function divRound(n: bigint, d: bigint, mode: RoundingMode = 'half_up'): bigint {
  if (d === 0n) return 0n;
  switch (mode) {
    case 'floor':
      return n / d;
    case 'ceil':
      return (n + d - 1n) / d;
    case 'bankers': {
      // round-half-to-even: only differs from half_up exactly at the .5 boundary
      const q = n / d;
      const r = n % d;
      const twice = r * 2n;
      if (twice < d) return q;
      if (twice > d) return q + 1n;
      return q % 2n === 0n ? q : q + 1n;
    }
    default:
      return (n + d / 2n) / d; // half_up
  }
}

export function calculateCharge(input: ChargeInput, rules: BillingRules): ChargeResult {
  const trace: TraceStep[] = [];
  const mode = rules.attendanceByKind?.[input.kind] ?? rules.attendance.mode;

  // --- 1. base
  let amount = input.baseTiyin;
  trace.push({ step: 'base', amount, note: input.kind });

  // --- 2/3. attendance factor
  if (mode === 'per_attended_day') {
    const { billableDays, attendedDays } = input;

    if (billableDays === 0) {
      amount = 0n;
      trace.push({ step: 'attendance', amount, note: 'no billable days in period' });
    } else {
      let days = attendedDays;
      if (rules.attendance.capAtFullTariff && days > billableDays) days = billableDays;

      amount = divRound(amount * BigInt(days), BigInt(billableDays), rules.rounding.mode);
      trace.push({
        step: 'attendance',
        amount,
        note: `${days}/${billableDays} days`,
        factor: `${days}/${billableDays}`,
      });
    }

    if (attendedDays === 0) {
      switch (rules.attendance.noAttendanceBehaviour) {
        case 'full_tariff':
          amount = input.baseTiyin;
          break;
        case 'min_charge':
          amount = BigInt(rules.attendance.minChargeTiyin);
          break;
        default:
          amount = 0n;
      }
      trace.push({ step: 'no_attendance', amount, note: rules.attendance.noAttendanceBehaviour });
    }
  }

  // --- 4/5. discounts, in configured order
  const discountable = rules.discount.appliesTo.includes(input.kind);
  if (discountable) {
    for (const phase of rules.discount.order) {
      // ["fixed", "percent"]

      if (phase === 'fixed') {
        const total =
          rules.discount.multipleFixed === 'largest_only'
            ? input.fixedDiscountsTiyin.reduce((a, b) => (b > a ? b : a), 0n)
            : input.fixedDiscountsTiyin.reduce((a, b) => a + b, 0n);
        amount -= total;
        trace.push({ step: 'discount_fixed', amount, note: `-${total}` });
      }

      if (phase === 'percent') {
        if (rules.discount.multiplePercent === 'compound') {
          for (const bp of input.percentDiscountsBp) {
            amount -= divRound(amount * BigInt(bp), 10_000n, rules.rounding.mode);
          }
        } else {
          const totalBp = input.percentDiscountsBp.reduce((a, b) => a + b, 0);
          const capped = Math.min(totalBp, 10_000); // never exceed 100%
          amount -= divRound(amount * BigInt(capped), 10_000n, rules.rounding.mode);
        }
        trace.push({ step: 'discount_percent', amount });
      }
    }
  }

  // --- 6. floor
  const floor = BigInt(rules.discount.floorTiyin);
  if (amount < floor) {
    amount = floor;
    trace.push({ step: 'floor', amount });
  }

  // --- 7. rounding unit
  if (rules.rounding.unit !== 'tiyin') {
    const unit = rules.rounding.unit === 'som' ? 100n : 100_000n;
    amount = divRound(amount, unit, rules.rounding.mode) * unit;
    trace.push({ step: 'round', amount, note: rules.rounding.unit });
  }

  return { amountTiyin: amount, trace };
}
