import { z } from 'zod';
import { AppErrors } from '../common/exceptions/app.exception';
import { BillingRules } from './billing-rules.types';

const money = z
  .string()
  .regex(/^\d+$/)
  .refine((v) => BigInt(v) <= 9223372036854775807n);
const mode = z.enum(['flat_monthly', 'per_attended_day', 'per_working_day']);
const kind = z.enum([
  'monthly_fixed',
  'full_day',
  'half_day',
  'group_based',
  'attendance_based',
  'meal',
  'transport',
  'extra_class',
  'registration_fee',
]);
const status = z.enum([
  'present',
  'late',
  'early_departure',
  'absent',
  'sick',
  'vacation',
  'excused',
]);
export const billingRulesSchema = z
  .object({
    version: z.number().int().positive(),
    // Advance/estimate billing needs a separately agreed policy. Never accept a silent no-op.
    billingTiming: z.literal('arrears'),
    attendance: z
      .object({
        mode,
        billableStatuses: z.array(status),
        nonBillableStatuses: z.array(status),
        divisor: z.enum(['actual_working_days', 'fixed', 'calendar_days']),
        fixedDivisor: z.number().int().min(1).max(366),
        capAtFullTariff: z.boolean(),
        minChargeTiyin: money,
        noAttendanceBehaviour: z.enum(['zero', 'min_charge', 'full_tariff']),
      })
      .strict(),
    attendanceByKind: z.record(kind, mode),
    discount: z
      .object({
        order: z.union([
          z.tuple([z.literal('fixed'), z.literal('percent')]),
          z.tuple([z.literal('percent'), z.literal('fixed')]),
        ]),
        multipleFixed: z.enum(['sum', 'largest_only']),
        multiplePercent: z.enum(['sum', 'compound']),
        appliesTo: z.array(kind),
        floorTiyin: money,
        applyBeforeAttendance: z.boolean(),
      })
      .strict(),
    rounding: z
      .object({
        unit: z.enum(['tiyin', 'som', '1000_som']),
        mode: z.enum(['half_up', 'floor', 'ceil', 'bankers']),
      })
      .strict(),
    proration: z
      .object({
        enrollmentMidMonth: z.enum(['per_attended_day', 'full_month']),
        withdrawalMidMonth: z.enum(['per_attended_day', 'full_month']),
        divisorRespectsEnrollmentWindow: z.boolean(),
      })
      .strict(),
    recalculation: z
      .object({
        onAttendanceCorrection: z.enum([
          'reverse_and_reissue_if_open',
          'adjust_next_period',
          'manual_only',
        ]),
        closedPeriodPolicy: z.enum(['adjust_next_period', 'manual_only']),
      })
      .strict(),
  })
  .strict()
  .superRefine((rules, ctx) => {
    if (
      rules.attendance.billableStatuses.some((s) =>
        rules.attendance.nonBillableStatuses.includes(s),
      )
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['attendance', 'billableStatuses'],
        message: 'Billable and non-billable statuses must not overlap',
      });
    }
  });

export function validateBillingRules(value: unknown): BillingRules {
  const result = billingRulesSchema.safeParse(value);
  if (!result.success)
    throw AppErrors.validationFailed(
      result.error.issues.map((i) => ({
        path: ['rules', ...i.path].join('.'),
        message: i.message,
      })),
    );
  return result.data as BillingRules;
}
