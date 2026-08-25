/**
 * The configurable billing engine's rule shape (03-billing-rules.md §2).
 * Stored as JSONB on `billing_rules`, versioned and effective-dated —
 * editing rules never mutates a row, it creates version N+1. A charge
 * always stores which version produced it, so it can be recomputed
 * identically years later.
 */

export type AttendanceMode = 'flat_monthly' | 'per_attended_day' | 'per_working_day';
export type RoundingMode = 'half_up' | 'floor' | 'ceil' | 'bankers';
export type TariffKind =
  | 'monthly_fixed'
  | 'full_day'
  | 'half_day'
  | 'group_based'
  | 'attendance_based'
  | 'meal'
  | 'transport'
  | 'extra_class'
  | 'registration_fee';

export interface BillingRules {
  version: number;
  billingTiming: 'arrears' | 'advance' | 'estimate_then_trueup';

  attendance: {
    mode: AttendanceMode;
    billableStatuses: string[];
    nonBillableStatuses: string[];
    divisor: 'actual_working_days' | 'fixed' | 'calendar_days';
    fixedDivisor: number;
    capAtFullTariff: boolean;
    minChargeTiyin: string;
    noAttendanceBehaviour: 'zero' | 'min_charge' | 'full_tariff';
  };

  /** Per-kind override — e.g. meals scale per attended day, extra classes stay flat. */
  attendanceByKind: Partial<Record<TariffKind, AttendanceMode>>;

  discount: {
    order: ['fixed', 'percent'] | ['percent', 'fixed'];
    multipleFixed: 'sum' | 'largest_only';
    multiplePercent: 'sum' | 'compound';
    appliesTo: TariffKind[];
    floorTiyin: string;
    applyBeforeAttendance: boolean;
  };

  rounding: {
    unit: 'tiyin' | 'som' | '1000_som';
    mode: RoundingMode;
  };

  proration: {
    enrollmentMidMonth: 'per_attended_day' | 'full_month';
    withdrawalMidMonth: 'per_attended_day' | 'full_month';
    divisorRespectsEnrollmentWindow: boolean;
  };

  recalculation: {
    onAttendanceCorrection: 'reverse_and_reissue_if_open' | 'adjust_next_period' | 'manual_only';
    closedPeriodPolicy: 'adjust_next_period' | 'manual_only';
  };
}

export interface TraceStep {
  step: string;
  amount: bigint;
  note?: string;
  factor?: string;
}

export interface ChargeInput {
  baseTiyin: bigint;
  kind: TariffKind;
  attendedDays: number;
  billableDays: number; // working days ∩ enrollment window
  fixedDiscountsTiyin: bigint[];
  percentDiscountsBp: number[]; // 10% = 1000 bp
}

export interface ChargeResult {
  amountTiyin: bigint;
  trace: TraceStep[];
}
