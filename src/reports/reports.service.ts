import { Injectable } from '@nestjs/common';
import { TenantPrisma } from '../prisma/tenant-prisma.provider';
import { AuthContext } from '../common/auth-context';
import { AttendanceService } from '../attendance/attendance.service';
import { DebtsService } from '../debts/debts.service';
import { ExpensesService } from '../expenses/expenses.service';
import { ReportResult } from './xlsx-export';

function dateOnly(iso: string): Date {
  return new Date(iso);
}

function monthRange(year: number, month: number): { from: Date; to: Date } {
  const from = new Date(Date.UTC(year, month - 1, 1));
  const to = new Date(Date.UTC(year, month, 0)); // last day of month
  return { from, to };
}

const childName = (c: { firstName: string; lastName: string } | null | undefined) =>
  c ? `${c.firstName} ${c.lastName}` : '';

/**
 * One method per report in 04-api-spec.md §11. Each returns {columns, rows}
 * — the same shape feeds the `json` response body and the xlsx exporter,
 * so there is exactly one query per report regardless of ?format=.
 * Reuses the existing domain services (Attendance/Debts/Expenses) rather
 * than re-deriving their aggregation logic; everything else queries
 * TenantPrisma directly since no other module exposes a tenant-wide list
 * for it.
 */
@Injectable()
export class ReportsService {
  constructor(
    private readonly tenantPrisma: TenantPrisma,
    private readonly attendance: AttendanceService,
    private readonly debts: DebtsService,
    private readonly expenses: ExpensesService,
  ) {}

  async attendanceDaily(ctx: AuthContext, date: string, groupId?: string): Promise<ReportResult> {
    const rows = await this.attendance.list(ctx, { date, groupId });
    return {
      columns: [
        { key: 'child', header: 'Child' },
        { key: 'status', header: 'Status' },
        { key: 'checkInAt', header: 'Check-in' },
        { key: 'checkOutAt', header: 'Check-out' },
      ],
      rows: rows.map((r) => ({
        child: childName(r.child),
        status: r.status,
        checkInAt: r.checkInAt,
        checkOutAt: r.checkOutAt,
      })),
    };
  }

  async attendanceMonthly(
    ctx: AuthContext,
    year: number,
    month: number,
    groupId?: string,
  ): Promise<ReportResult> {
    const { from, to } = monthRange(year, month);
    const summary = await this.attendance.summary(
      ctx,
      groupId,
      from.toISOString().slice(0, 10),
      to.toISOString().slice(0, 10),
    );
    return {
      columns: [
        { key: 'child', header: 'Child' },
        { key: 'present', header: 'Present days' },
        { key: 'absent', header: 'Absent days' },
        { key: 'other', header: 'Other' },
      ],
      rows: summary.map((s: any) => ({
        child: childName(s.child),
        present: s.present,
        absent: s.absent,
        other: s.other,
      })),
    };
  }

  async attendanceCorrections(filters: { from?: string; to?: string }): Promise<ReportResult> {
    const rows = await this.attendance.corrections(filters);
    return {
      columns: [
        { key: 'child', header: 'Child' },
        { key: 'date', header: 'Date' },
        { key: 'field', header: 'Field' },
        { key: 'oldValue', header: 'Old value' },
        { key: 'newValue', header: 'New value' },
        { key: 'reason', header: 'Reason' },
      ],
      rows: (rows as any[]).map((r) => ({
        child: childName(r.attendanceDay?.child),
        date: r.attendanceDay?.attendanceDate,
        field: r.field,
        oldValue: r.oldValue,
        newValue: r.newValue,
        reason: r.reason,
      })),
    };
  }

  async childrenActive(groupId?: string): Promise<ReportResult> {
    const rows = await this.tenantPrisma.db.child.findMany({
      where: {
        status: 'active',
        ...(groupId ? { groupAssignment: { some: { groupId, effectiveTo: null } } } : {}),
      },
      select: {
        firstName: true,
        lastName: true,
        birthDate: true,
        enrollmentDate: true,
        groupAssignment: {
          where: { effectiveTo: null },
          select: { childGroup: { select: { name: true } } },
        },
      },
    });
    return {
      columns: [
        { key: 'child', header: 'Child' },
        { key: 'birthDate', header: 'Birth date' },
        { key: 'enrollmentDate', header: 'Enrollment date' },
        { key: 'group', header: 'Group' },
      ],
      rows: rows.map((r) => ({
        child: childName(r),
        birthDate: r.birthDate,
        enrollmentDate: r.enrollmentDate,
        group: r.groupAssignment[0]?.childGroup?.name ?? '',
      })),
    };
  }

  async childrenEnrollments(from?: string, to?: string): Promise<ReportResult> {
    const rows = await this.tenantPrisma.db.child.findMany({
      where: {
        enrollmentDate: {
          gte: from ? dateOnly(from) : undefined,
          lte: to ? dateOnly(to) : undefined,
        },
      },
      select: { firstName: true, lastName: true, enrollmentDate: true, status: true },
      orderBy: { enrollmentDate: 'desc' },
    });
    return {
      columns: [
        { key: 'child', header: 'Child' },
        { key: 'enrollmentDate', header: 'Enrollment date' },
        { key: 'status', header: 'Status' },
      ],
      rows: rows.map((r) => ({
        child: childName(r),
        enrollmentDate: r.enrollmentDate,
        status: r.status,
      })),
    };
  }

  /** Documents expiring within 30 days — the whole point of tracking expiryDate at all. */
  async childrenDocumentsExpiring(): Promise<ReportResult> {
    const horizon = new Date();
    horizon.setDate(horizon.getDate() + 30);
    const rows = await this.tenantPrisma.db.childDocument.findMany({
      where: { deletedAt: null, expiryDate: { not: null, lte: horizon } },
      include: { child: { select: { firstName: true, lastName: true } } },
      orderBy: { expiryDate: 'asc' },
    });
    return {
      columns: [
        { key: 'child', header: 'Child' },
        { key: 'docType', header: 'Document' },
        { key: 'expiryDate', header: 'Expires' },
      ],
      rows: rows.map((r) => ({
        child: childName(r.child),
        docType: r.docType,
        expiryDate: r.expiryDate,
      })),
    };
  }

  async childrenMedicalAlerts(): Promise<ReportResult> {
    const rows = await this.tenantPrisma.db.allergy.findMany({
      where: { deletedAt: null },
      include: { child: { select: { firstName: true, lastName: true } } },
    });
    return {
      columns: [
        { key: 'child', header: 'Child' },
        { key: 'allergen', header: 'Allergen' },
        { key: 'severity', header: 'Severity' },
        { key: 'instruction', header: 'Instruction' },
      ],
      rows: rows.map((r) => ({
        child: childName(r.child),
        allergen: r.allergen,
        severity: r.severity,
        instruction: r.instruction ?? '',
      })),
    };
  }

  async financeCharges(periodId?: string): Promise<ReportResult> {
    const rows = await this.tenantPrisma.db.charge.findMany({
      where: { periodId },
      include: { child: { select: { firstName: true, lastName: true } } },
      orderBy: { issuedAt: 'desc' },
      take: 5000,
    });
    return {
      columns: [
        { key: 'child', header: 'Child' },
        { key: 'kind', header: 'Kind' },
        { key: 'amountTiyin', header: 'Amount (tiyin)' },
        { key: 'sign', header: 'Sign' },
        { key: 'issuedAt', header: 'Issued at' },
      ],
      rows: rows.map((r) => ({
        child: childName(r.child),
        kind: r.kind,
        amountTiyin: r.amountTiyin.toString(),
        sign: r.sign,
        issuedAt: r.issuedAt,
      })),
    };
  }

  async financePayments(from?: string, to?: string, method?: string): Promise<ReportResult> {
    const rows = await this.tenantPrisma.db.payment.findMany({
      where: {
        method,
        paidAt: {
          gte: from ? dateOnly(from) : undefined,
          lte: to ? dateOnly(to) : undefined,
        },
      },
      include: { child: { select: { firstName: true, lastName: true } } },
      orderBy: { paidAt: 'desc' },
      take: 5000,
    });
    return {
      columns: [
        { key: 'child', header: 'Child' },
        { key: 'amountTiyin', header: 'Amount (tiyin)' },
        { key: 'method', header: 'Method' },
        { key: 'paidAt', header: 'Paid at' },
        { key: 'receiptNo', header: 'Receipt' },
      ],
      rows: rows.map((r) => ({
        child: childName(r.child),
        amountTiyin: r.amountTiyin.toString(),
        method: r.method,
        paidAt: r.paidAt,
        receiptNo: r.receiptNo ?? '',
      })),
    };
  }

  async financeDebts(overdueOnly: boolean): Promise<ReportResult> {
    const rows = await this.debts.list({ overdueOnly });
    return {
      columns: [
        { key: 'child', header: 'Child' },
        { key: 'chargedTiyin', header: 'Charged (tiyin)' },
        { key: 'paidTiyin', header: 'Paid (tiyin)' },
        { key: 'debtTiyin', header: 'Debt (tiyin)' },
      ],
      rows: rows.map((r) => ({
        child: `${r.firstName} ${r.lastName}`,
        chargedTiyin: r.chargedTiyin,
        paidTiyin: r.paidTiyin,
        debtTiyin: r.debtTiyin,
      })),
    };
  }

  async financeDiscounts(from?: string, to?: string): Promise<ReportResult> {
    const rows = await this.tenantPrisma.db.discount.findMany({
      where: {
        createdAt: {
          gte: from ? dateOnly(from) : undefined,
          lte: to ? dateOnly(to) : undefined,
        },
      },
      include: { child: { select: { firstName: true, lastName: true } } },
      orderBy: { createdAt: 'desc' },
    });
    return {
      columns: [
        { key: 'child', header: 'Child' },
        { key: 'kind', header: 'Kind' },
        { key: 'valueTiyin', header: 'Value (tiyin)' },
        { key: 'valueBp', header: 'Value (bp)' },
        { key: 'reason', header: 'Reason' },
        { key: 'revoked', header: 'Revoked' },
      ],
      rows: rows.map((r) => ({
        child: childName(r.child),
        kind: r.kind,
        valueTiyin: r.valueTiyin?.toString() ?? '',
        valueBp: r.valueBp ?? '',
        reason: r.reason,
        revoked: r.revokedAt ? 'yes' : 'no',
      })),
    };
  }

  /** Reversed charges + cancelled payments — the audit trail of "money that moved backwards". */
  async financeCancellations(from?: string, to?: string): Promise<ReportResult> {
    const dateFilter = {
      gte: from ? dateOnly(from) : undefined,
      lte: to ? dateOnly(to) : undefined,
    };
    const [reversedCharges, cancelledPayments] = await Promise.all([
      this.tenantPrisma.db.charge.findMany({
        where: { sign: -1, issuedAt: dateFilter as any },
        include: { child: { select: { firstName: true, lastName: true } } },
      }),
      this.tenantPrisma.db.payment.findMany({
        where: { sign: -1, paidAt: dateFilter as any },
        include: { child: { select: { firstName: true, lastName: true } } },
      }),
    ]);
    return {
      columns: [
        { key: 'type', header: 'Type' },
        { key: 'child', header: 'Child' },
        { key: 'amountTiyin', header: 'Amount (tiyin)' },
        { key: 'date', header: 'Date' },
        { key: 'reason', header: 'Reason' },
      ],
      rows: [
        ...reversedCharges.map((c) => ({
          type: 'charge_reversal',
          child: childName(c.child),
          amountTiyin: c.amountTiyin.toString(),
          date: c.issuedAt,
          reason: c.reversalReason ?? '',
        })),
        ...cancelledPayments.map((p) => ({
          type: 'payment_cancellation',
          child: childName(p.child),
          amountTiyin: p.amountTiyin.toString(),
          date: p.paidAt,
          reason: p.cancelReason ?? '',
        })),
      ],
    };
  }

  async expensesMonthly(year: number, month?: number): Promise<ReportResult> {
    const rows = await this.expenses.list({ year, month });
    return {
      columns: [
        { key: 'type', header: 'Type' },
        { key: 'provider', header: 'Provider' },
        { key: 'amountTiyin', header: 'Amount (tiyin)' },
        { key: 'status', header: 'Status' },
        { key: 'dueDate', header: 'Due date' },
      ],
      rows: rows.map((r) => ({
        type: r.expenseType,
        provider: r.provider ?? '',
        amountTiyin: r.amountTiyin.toString(),
        status: r.status,
        dueDate: r.dueDate,
      })),
    };
  }
}
