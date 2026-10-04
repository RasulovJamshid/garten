import { AuthContext, PermissionScope } from '../common/auth-context';
import { AppErrors } from '../common/exceptions/app.exception';

const DOMAINS: Record<string, string[]> = {
  'attendance/daily': ['attendance:read'],
  'attendance/monthly': ['attendance:read'],
  'attendance/corrections': ['attendance:correct'],
  'children/active': ['child:read'],
  'children/enrollments': ['child:read'],
  'children/documents-expiring': ['child:read'],
  'children/medical-alerts': ['medical:alerts'],
  'finance/charges': ['charge:read'],
  'finance/payments': ['payment:read'],
  'finance/debts': ['debt:read'],
  'finance/discounts': ['discount:manage'],
  'finance/cancellations': ['charge:read', 'payment:read'],
  'expenses/monthly': ['expense:read'],
};

export interface ReportAccess {
  permissions: Record<string, PermissionScope>;
  branches: Record<string, string[]>;
  groups: string[];
}

export function captureReportAccess(ctx: AuthContext, reportKey: string): ReportAccess {
  const domain = DOMAINS[reportKey];
  if (!domain) throw AppErrors.notFound('Unknown report');
  const permissions: ReportAccess['permissions'] = {};
  const branches: ReportAccess['branches'] = {};
  for (const key of ['report:read', ...domain]) {
    const scope = ctx.scopeFor(key);
    if (!scope) throw AppErrors.forbidden('Report access has been revoked');
    permissions[key] = scope;
    branches[key] = scope === 'all' ? [] : ctx.requireBranchIds(key);
  }
  return { permissions, branches, groups: [...ctx.ownGroupIds] };
}

export function assertExportAccess(
  ctx: AuthContext,
  job: { createdBy: string; reportKey: string; params: any; expiresAt: Date | null },
): void {
  if (job.createdBy !== ctx.userId) throw AppErrors.notFound('Export job not found');
  if (job.expiresAt && job.expiresAt <= new Date()) throw AppErrors.notFound('Export has expired');
  const current = captureReportAccess(ctx, job.reportKey);
  const saved = job.params?.__access as ReportAccess | undefined;
  if (!saved)
    throw AppErrors.conflict('EXPORT_REGENERATE: create a new export with current permissions');
  for (const [key, scope] of Object.entries(saved.permissions)) {
    const now = current.permissions[key];
    if (now === 'all') continue;
    if (
      scope === 'all' ||
      !now ||
      (scope === 'branch' && now !== 'branch') ||
      (saved.branches[key] ?? []).some((id) => !current.branches[key]?.includes(id)) ||
      (now === 'own_group' && saved.groups.some((id) => !current.groups.includes(id)))
    )
      throw AppErrors.forbidden('Report access has narrowed; generate a new export');
  }
}
