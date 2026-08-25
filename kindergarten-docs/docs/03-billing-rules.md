# Billing Rules Engine — Configurable, Versioned

**Confirmed rules:**
1. Discounts apply **fixed first, then percentage**.
2. Parents pay **only for days the child attended**.
3. Both must be changeable later without a code deploy or data migration.

---

## 0. The one consequence you must accept before building this

**Pay-per-attended-day forces billing in arrears.** You cannot know March's attendance until March ends, so March's invoice can only be generated on April 1st.

This changes the operating model:

| | Advance billing (flat monthly) | Arrears billing (per attended day) |
|---|---|---|
| Charge generated | 1st of the month, for that month | 1st of the month, for the **previous** month |
| Cash flow | Money arrives before service | Money arrives after service |
| Debt risk | Low — non-payers are excluded early | **Higher** — a child can attend all month and never pay |
| Parent expectation | "Pay by the 5th for this month" | "Pay by the 5th for last month" |

**Mitigations to discuss with the client now, not later:**
- **Deposit / advance payment** at enrollment, equal to ~1 month, held as credit and applied to the final month. This is the standard answer and the ledger already supports it (unallocated payment = advance credit).
- **Estimated advance + true-up**: charge a flat estimate on the 1st, then issue a correcting charge (positive or negative) once the month closes. The reversal mechanism supports this cleanly. This is `mode: "estimate_then_trueup"` below.

Start with plain arrears. The engine supports switching to true-up later without schema change.

---

## 1. Design principle: rules are versioned data, charges are immutable snapshots

Configurable does **not** mean "a global setting that gets edited." If someone edits the discount order in November, every charge from January to October must still recalculate identically — otherwise reconciliation, audits, and parent disputes become unresolvable.

So:

```
billing_rules
  id, tenant_id, version INT, effective_from DATE, effective_to DATE NULL,
  rules JSONB, created_by, created_at, note TEXT
  UNIQUE (tenant_id, version)
  -- no overlapping effective ranges per tenant (exclusion constraint)

charge
  ...
  billing_rules_id      -- WHICH rule set produced this charge
  tariff_snapshot JSONB -- what the tariff was
  calculation_trace JSONB  -- every intermediate step, see §5
```

Editing rules never mutates a row. It creates **version N+1** with a new `effective_from`. Past periods keep pointing at the version that produced them, and any charge can be recomputed and proven years later.

---

## 2. Rule configuration schema

```jsonc
{
  "version": 1,
  "billingTiming": "arrears",          // "arrears" | "advance" | "estimate_then_trueup"

  "attendance": {
    "mode": "per_attended_day",        // "flat_monthly" | "per_attended_day" | "per_working_day"
    "billableStatuses":    ["present", "late", "early_departure"],
    "nonBillableStatuses": ["absent", "sick", "vacation", "excused"],
    "divisor": "actual_working_days",  // "actual_working_days" | "fixed" | "calendar_days"
    "fixedDivisor": 22,                // used only when divisor = "fixed"
    "capAtFullTariff": true,           // attended > divisor never costs more than 1 month
    "minChargeTiyin": "0",
    "noAttendanceBehaviour": "zero"    // "zero" | "min_charge" | "full_tariff"
  },

  // per-kind override: meals are only eaten on attended days, tuition might not be
  "attendanceByKind": {
    "monthly_fixed": "per_attended_day",
    "meal":          "per_attended_day",
    "transport":     "per_attended_day",
    "extra_class":   "flat_monthly",
    "registration_fee": "flat_monthly"
  },

  "discount": {
    "order": ["fixed", "percent"],     // <-- CONFIRMED: fixed first, then percent
    "multipleFixed":   "sum",          // "sum" | "largest_only"
    "multiplePercent": "sum",          // "sum" (10%+5% = 15%) | "compound" (10% then 5%)
    "appliesTo": ["monthly_fixed"],    // discounts hit tuition only, not meals/transport
    "floorTiyin": "0",                 // result can never go below this
    "applyBeforeAttendance": false     // false = attendance first, then discount
  },

  "rounding": {
    "unit": "tiyin",                   // "tiyin" | "som" | "1000_som"
    "mode": "half_up"                  // "half_up" | "floor" | "ceil" | "bankers"
  },

  "proration": {
    "enrollmentMidMonth": "per_attended_day",
    "withdrawalMidMonth": "per_attended_day",
    "divisorRespectsEnrollmentWindow": true
  },

  "recalculation": {
    "onAttendanceCorrection": "reverse_and_reissue_if_open",
    // "reverse_and_reissue_if_open" | "adjust_next_period" | "manual_only"
    "closedPeriodPolicy": "adjust_next_period"
  }
}
```

Every field is a decision that would otherwise be buried in code. Read this file to the accountant line by line in week 1 — it *is* the requirements interview.

---

## 3. Calculation pipeline — fixed, canonical order

```
1.  Resolve tariff base amount for the child/period      -> baseTiyin
2.  Compute attendance factor (attendedDays / billableDays)
3.  attendanceAdjusted = round(base * attended / divisor)   [skipped if flat_monthly]
4.  Apply FIXED discounts   (sum)  -> afterFixed = attendanceAdjusted - sumFixed
5.  Apply PERCENT discounts (sum)  -> afterPercent = afterFixed * (1 - pct)
6.  Floor at discount.floorTiyin
7.  Round per rounding config
8.  Extras (meal / transport / extra_class) computed separately as their own
    charge rows, each with its own attendanceByKind mode, NOT discounted
    unless listed in discount.appliesTo
```

Step 4 before step 5 is the confirmed rule. Worked example:

```
Tariff:              1 500 000 som   (150 000 000 tiyin)
Working days:        22
Attended:            18
Fixed discount:        200 000 som   (sibling discount)
Percent discount:           10 %     (staff child)

attendanceAdjusted = 1 500 000 * 18 / 22        = 1 227 273
afterFixed         = 1 227 273 - 200 000        = 1 027 273
afterPercent       = 1 027 273 * 0.90           =   924 546   <- final

If order were percent-first: (1 227 273 * 0.9) - 200 000 = 904 546
Fixed-first is 20 000 som higher — favourable to the kindergarten, and the
confirmed rule.
```

**Attendance is applied before discounts** (`applyBeforeAttendance: false`). This means a fixed discount is *not* prorated by attendance — a 200,000 sibling discount is worth the full 200,000 even if the child attended 10 days. If the client wants the discount prorated too, flip the flag; the engine handles both.

---

## 4. Implementation — pure function, integer math only

```ts
// billing/calculate-charge.ts
// No floats anywhere. All money is BigInt tiyin. Percentages are basis points.

type Bp = number;              // 10% = 1000 bp

interface ChargeInput {
  baseTiyin: bigint;
  kind: TariffKind;
  attendedDays: number;
  billableDays: number;        // working days ∩ enrollment window
  fixedDiscountsTiyin: bigint[];
  percentDiscountsBp: Bp[];
}

/** half-up division for positive bigints */
function divRound(n: bigint, d: bigint, mode: RoundingMode = 'half_up'): bigint {
  if (d === 0n) return 0n;
  switch (mode) {
    case 'floor': return n / d;
    case 'ceil':  return (n + d - 1n) / d;
    default:      return (n + d / 2n) / d;      // half_up
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
        step: 'attendance', amount,
        note: `${days}/${billableDays} days`,
        factor: `${days}/${billableDays}`,
      });
    }

    if (attendedDays === 0) {
      switch (rules.attendance.noAttendanceBehaviour) {
        case 'full_tariff': amount = input.baseTiyin; break;
        case 'min_charge':  amount = BigInt(rules.attendance.minChargeTiyin); break;
        default:            amount = 0n;
      }
      trace.push({ step: 'no_attendance', amount, note: rules.attendance.noAttendanceBehaviour });
    }
  }

  // --- 4/5. discounts, in configured order
  const discountable = rules.discount.appliesTo.includes(input.kind);
  if (discountable) {
    for (const phase of rules.discount.order) {          // ["fixed", "percent"]

      if (phase === 'fixed') {
        const total = rules.discount.multipleFixed === 'largest_only'
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
          const capped  = Math.min(totalBp, 10_000);      // never exceed 100%
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
```

**Why `trace` is not optional:** a parent will ask why their bill is 924,546 and not 900,000. The trace is stored on the charge as JSONB and rendered on the receipt. Without it, every dispute becomes a manual recomputation by hand.

---

## 5. Billable-days calculation

```ts
function billableDays(period: Period, child: Child, rules: BillingRules): number {
  if (rules.attendance.divisor === 'fixed')          return rules.attendance.fixedDivisor;
  if (rules.attendance.divisor === 'calendar_days')  return daysInMonth(period);

  // actual_working_days
  let days = workingDaysInMonth(period, settings.workingDays, holidays);

  if (rules.proration.divisorRespectsEnrollmentWindow) {
    // child enrolled on the 14th -> only count working days from the 14th
    days = intersect(days, child.enrollmentWindow);
  }
  return days;
}
```

This is what makes mid-month enrollment and withdrawal work **automatically** — no separate proration code path. A child enrolled on the 14th has a smaller divisor *and* fewer attended days, and the arithmetic handles it.

`workingDaysInMonth` reads `settings.workingDays` (Mon–Fri or Mon–Sat) minus the `holiday` table. Both are already in the schema.

---

## 6. Attendance corrections after billing

The scenario: charges committed for March on April 1st. On April 4th someone corrects a March attendance record.

```
period OPEN   -> reverse the charge (sign = -1), recalculate, issue a new one.
                 Both rows visible; the trace shows why.
period CLOSED -> create an adjustment charge in the CURRENT period,
                 kind = 'manual', referencing the original period and correction.
```

Governed by `recalculation.onAttendanceCorrection`. Default is `reverse_and_reissue_if_open`, which is the honest choice — the parent sees a correction rather than a silently changed number.

**Operational rule to give the client:** close the accounting period only after attendance corrections for that month have settled. Suggest closing on the 10th, billing on the 1st.

---

## 7. API

```
GET    /billing-rules                    list all versions
GET    /billing-rules/active?date=       version effective on a date
GET    /billing-rules/:id
POST   /billing-rules                    creates version N+1
       { effectiveFrom, rules, note }    requires tariff:manage + sensitive
GET    /billing-rules/:id/diff?against=  side-by-side change view

POST   /billing-rules/simulate           dry run, writes nothing
       { rulesId?, rules?, childId, year, month }
       -> { amountTiyin, trace[] }

POST   /billing-runs/:id/explain/:childId
       -> full trace for one child in a preview
```

`/simulate` is the endpoint that makes rule changes safe. Before committing version 2, run it across all active children and compare totals against version 1. If the delta is not what the accountant expects, do not commit.

**Guardrail:** `effectiveFrom` cannot fall inside a closed accounting period. `409 PERIOD_CLOSED`.

---

## 8. Mandatory tests

```
Discount order (the confirmed rule):
  ✓ fixed then percent produces 924 546 for the §3 example
  ✓ reversing order in config produces 904 546 — proves order is honoured
  ✓ fixed discount > base  -> floors at 0, never negative
  ✓ percent discounts summing > 100% -> capped, result 0
  ✓ multipleFixed: sum vs largest_only
  ✓ multiplePercent: sum (15%) vs compound (14.5%)

Attendance:
  ✓ 18/22 days, exact integer arithmetic, no float drift
  ✓ 22/22 days = exactly the full tariff (no rounding leak)
  ✓ 0 days -> zero / min_charge / full_tariff per config
  ✓ attended > billable (data error) -> capped at full tariff
  ✓ billableDays = 0 (month entirely holidays) -> no division by zero
  ✓ mid-month enrollment: divisor shrinks with the enrollment window
  ✓ mid-month withdrawal: same
  ✓ meals scale per-day while extra_class stays flat (attendanceByKind)

Versioning:
  ✓ a charge from rules v1 recomputes identically after v2 is created
  ✓ effectiveFrom inside a closed period is rejected
  ✓ simulate writes nothing to charge/payment

Rounding:
  ✓ sum of 100 children's charges has no accumulated drift
  ✓ rounding to 'som' and '1000_som' units
```

The 22/22 case matters more than it looks: `divRound(base * 22, 22)` must return `base` **exactly**. If your arithmetic ever returns `base - 1`, every fully-attending parent is undercharged by a tiyin and the annual reconciliation will never balance.

---

## 9. Still open — needs the accountant

1. **Sick days.** Currently non-billable. Common alternative: billable unless a doctor's note is provided, or billable for the first N days then free. Which?
2. **Vacation.** Same question. Many kindergartens charge a reduced "place-holding" fee to keep the spot.
3. **Meals on absent days.** Currently not charged. Confirm — some kitchens charge if not cancelled by a cutoff time.
4. **Deposit at enrollment?** Strongly recommended given arrears billing (§0).
5. **Payment deadline** — which day of the month is a charge overdue? Drives the ageing buckets.
6. **Registration fee** — one-time, refundable, and does it fall under discounts?
7. **Rounding unit** — to the tiyin, the som, or the nearest 1,000 som? Most local invoices round to som.
