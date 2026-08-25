import { AuthContext } from '../common/auth-context';
import { ReportsService } from './reports.service';
import { ReportResult } from './xlsx-export';

export type ReportParams = Record<string, string | undefined>;

export interface ReportDefinition {
  /** Also used as the workbook sheet name / PDF title / download filename. */
  title: string;
  run(reports: ReportsService, ctx: AuthContext, params: ReportParams): Promise<ReportResult>;
}

/**
 * One entry per route in ReportsController, keyed identically to the
 * route path (minus the /reports/ prefix) so an export_job's `reportKey`
 * unambiguously identifies which query to re-run in the background
 * (ExportWorkerService) — the same mapping the controller uses inline
 * for its synchronous path, just centralized so both agree.
 */
export const REPORT_REGISTRY: Record<string, ReportDefinition> = {
  'attendance/daily': {
    title: 'attendance-daily',
    run: (r, ctx, p) => r.attendanceDaily(ctx, p.date!, p.groupId),
  },
  'attendance/monthly': {
    title: 'attendance-monthly',
    run: (r, ctx, p) => r.attendanceMonthly(ctx, Number(p.year), Number(p.month), p.groupId),
  },
  'attendance/corrections': {
    title: 'attendance-corrections',
    run: (r, _ctx, p) => r.attendanceCorrections({ from: p.from, to: p.to }),
  },
  'children/active': {
    title: 'children-active',
    run: (r, _ctx, p) => r.childrenActive(p.groupId),
  },
  'children/enrollments': {
    title: 'children-enrollments',
    run: (r, _ctx, p) => r.childrenEnrollments(p.from, p.to),
  },
  'children/documents-expiring': {
    title: 'documents-expiring',
    run: (r) => r.childrenDocumentsExpiring(),
  },
  'children/medical-alerts': {
    title: 'medical-alerts',
    run: (r) => r.childrenMedicalAlerts(),
  },
  'finance/charges': {
    title: 'finance-charges',
    run: (r, _ctx, p) => r.financeCharges(p.periodId),
  },
  'finance/payments': {
    title: 'finance-payments',
    run: (r, _ctx, p) => r.financePayments(p.from, p.to, p.method),
  },
  'finance/debts': {
    title: 'finance-debts',
    run: (r, _ctx, p) => r.financeDebts(p.ageing === 'true' || p.ageing === 'overdue'),
  },
  'finance/discounts': {
    title: 'finance-discounts',
    run: (r, _ctx, p) => r.financeDiscounts(p.from, p.to),
  },
  'finance/cancellations': {
    title: 'finance-cancellations',
    run: (r, _ctx, p) => r.financeCancellations(p.from, p.to),
  },
  'expenses/monthly': {
    title: 'expenses-monthly',
    run: (r, _ctx, p) => r.expensesMonthly(Number(p.year), p.month ? Number(p.month) : undefined),
  },
};
