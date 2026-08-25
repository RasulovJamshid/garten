import { BillingRules } from './billing-rules.types';

/**
 * Version 1 — the confirmed rules from 03-billing-rules.md §2: fixed
 * discounts before percent, pay only for attended days, arrears billing.
 * Seeded as billing_rules version 1 on first use; every later edit
 * creates version N+1 rather than mutating this.
 */
export const DEFAULT_BILLING_RULES: BillingRules = {
  version: 1,
  billingTiming: 'arrears',

  attendance: {
    mode: 'per_attended_day',
    billableStatuses: ['present', 'late', 'early_departure'],
    nonBillableStatuses: ['absent', 'sick', 'vacation', 'excused'],
    divisor: 'actual_working_days',
    fixedDivisor: 22,
    capAtFullTariff: true,
    minChargeTiyin: '0',
    noAttendanceBehaviour: 'zero',
  },

  attendanceByKind: {
    monthly_fixed: 'per_attended_day',
    meal: 'per_attended_day',
    transport: 'per_attended_day',
    extra_class: 'flat_monthly',
    registration_fee: 'flat_monthly',
  },

  discount: {
    order: ['fixed', 'percent'],
    multipleFixed: 'sum',
    multiplePercent: 'sum',
    appliesTo: ['monthly_fixed'],
    floorTiyin: '0',
    applyBeforeAttendance: false,
  },

  rounding: {
    unit: 'tiyin',
    mode: 'half_up',
  },

  proration: {
    enrollmentMidMonth: 'per_attended_day',
    withdrawalMidMonth: 'per_attended_day',
    divisorRespectsEnrollmentWindow: true,
  },

  recalculation: {
    onAttendanceCorrection: 'reverse_and_reissue_if_open',
    closedPeriodPolicy: 'adjust_next_period',
  },
};
