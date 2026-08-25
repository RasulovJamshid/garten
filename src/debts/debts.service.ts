import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { TenantPrisma } from '../prisma/tenant-prisma.provider';

interface ChildBalanceRow {
  child_id: string;
  first_name: string;
  last_name: string;
  charged_tiyin: unknown;
  paid_tiyin: unknown;
  debt_tiyin: unknown;
  advance_tiyin: unknown;
}

interface AgeingRow {
  child_id: string;
  not_overdue: unknown;
  d1_7: unknown;
  d8_30: unknown;
  d30_plus: unknown;
  total_outstanding: unknown;
}

/**
 * Postgres's SUM() over a bigint column returns numeric, not bigint —
 * every aggregate in v_child_balance / v_debt_ageing comes back through
 * $queryRaw as a Prisma Decimal, not a native bigint. Mixing a Decimal
 * with a real bigint in arithmetic throws ("Cannot mix BigInt and other
 * types"), so every raw-query numeric is normalized through this the
 * moment it arrives — nothing downstream ever touches a Decimal.
 */
function toBigInt(v: unknown): bigint {
  if (v === null || v === undefined) return 0n;
  return BigInt(v.toString());
}

/**
 * Reads the finance views that already exist in the DB
 * (v_child_balance, v_charge_outstanding, v_debt_ageing) — balance is
 * always derived, never stored (01-stage1-plan.md §3.2). These are raw
 * SQL, so every query carries an explicit tenant_id filter by hand — the
 * tenant-scoping Prisma extension does not (cannot) intercept $queryRaw.
 */
@Injectable()
export class DebtsService {
  constructor(private readonly tenantPrisma: TenantPrisma) {}

  async list(filters: { groupId?: string; overdueOnly?: boolean; minAmountTiyin?: string }) {
    const tenantId = this.tenantPrisma.tenantId;

    const conditions: Prisma.Sql[] = [Prisma.sql`cb.tenant_id = ${tenantId}::uuid`];
    if (filters.groupId) conditions.push(Prisma.sql`ga.group_id = ${filters.groupId}::uuid`);
    if (filters.overdueOnly) conditions.push(Prisma.sql`cb.debt_tiyin > 0`);
    if (filters.minAmountTiyin) {
      conditions.push(Prisma.sql`cb.debt_tiyin >= ${BigInt(filters.minAmountTiyin)}`);
    }

    const rows = await this.tenantPrisma.db.$queryRaw<ChildBalanceRow[]>`
      SELECT cb.child_id, c.first_name, c.last_name,
             cb.charged_tiyin, cb.paid_tiyin, cb.debt_tiyin, cb.advance_tiyin
      FROM v_child_balance cb
      JOIN child c ON c.id = cb.child_id
      LEFT JOIN group_assignment ga ON ga.child_id = cb.child_id AND ga.effective_to IS NULL
      WHERE ${Prisma.join(conditions, ' AND ')}
      ORDER BY cb.debt_tiyin DESC
    `;

    return rows.map((r) => ({
      childId: r.child_id,
      firstName: r.first_name,
      lastName: r.last_name,
      chargedTiyin: toBigInt(r.charged_tiyin).toString(),
      paidTiyin: toBigInt(r.paid_tiyin).toString(),
      debtTiyin: toBigInt(r.debt_tiyin).toString(),
      advanceTiyin: toBigInt(r.advance_tiyin).toString(),
    }));
  }

  async forChild(childId: string) {
    const tenantId = this.tenantPrisma.tenantId;

    const [balanceRows, ageingRows] = await Promise.all([
      this.tenantPrisma.db.$queryRaw<ChildBalanceRow[]>`
        SELECT cb.child_id, c.first_name, c.last_name,
               cb.charged_tiyin, cb.paid_tiyin, cb.debt_tiyin, cb.advance_tiyin
        FROM v_child_balance cb
        JOIN child c ON c.id = cb.child_id
        WHERE cb.tenant_id = ${tenantId}::uuid AND cb.child_id = ${childId}::uuid
      `,
      this.tenantPrisma.db.$queryRaw<AgeingRow[]>`
        SELECT child_id, not_overdue, d1_7, d8_30, d30_plus, total_outstanding
        FROM v_debt_ageing
        WHERE tenant_id = ${tenantId}::uuid AND child_id = ${childId}::uuid
      `,
    ]);

    const balance = balanceRows[0];
    const ageing = ageingRows[0];

    // Best-effort split: how much of the current debt was billed in the
    // most recent period this child has a charge in, versus carried over
    // from earlier periods.
    const latestCharge = await this.tenantPrisma.db.charge.findFirst({
      where: { childId, sign: 1 },
      orderBy: { issuedAt: 'desc' },
      select: { periodId: true },
    });
    let currentChargeTiyin = 0n;
    if (latestCharge) {
      const samePeriodCharges = await this.tenantPrisma.db.charge.findMany({
        where: { childId, periodId: latestCharge.periodId },
      });
      currentChargeTiyin = samePeriodCharges.reduce(
        (acc, c) => acc + c.amountTiyin * BigInt(c.sign),
        0n,
      );
    }

    const debtTiyin = toBigInt(balance?.debt_tiyin);
    const totalOutstanding = toBigInt(ageing?.total_outstanding);
    const notOverdue = toBigInt(ageing?.not_overdue);

    return {
      childId,
      currentChargeTiyin: currentChargeTiyin.toString(),
      previousDebtTiyin: (debtTiyin - currentChargeTiyin).toString(),
      totalPaidTiyin: toBigInt(balance?.paid_tiyin).toString(),
      advanceBalanceTiyin: toBigInt(balance?.advance_tiyin).toString(),
      currentDebtTiyin: debtTiyin.toString(),
      overdueAmountTiyin: (totalOutstanding - notOverdue).toString(),
      ageing: {
        notOverdue: notOverdue.toString(),
        d1_7: toBigInt(ageing?.d1_7).toString(),
        d8_30: toBigInt(ageing?.d8_30).toString(),
        d30plus: toBigInt(ageing?.d30_plus).toString(),
      },
    };
  }

  async summary() {
    const tenantId = this.tenantPrisma.tenantId;

    const byGroup = await this.tenantPrisma.db.$queryRaw<
      { group_id: string | null; group_name: string | null; total_debt: unknown }[]
    >`
      SELECT ga.group_id, g.name AS group_name, SUM(cb.debt_tiyin) AS total_debt
      FROM v_child_balance cb
      LEFT JOIN group_assignment ga ON ga.child_id = cb.child_id AND ga.effective_to IS NULL
      LEFT JOIN child_group g ON g.id = ga.group_id
      WHERE cb.tenant_id = ${tenantId}::uuid AND cb.debt_tiyin > 0
      GROUP BY ga.group_id, g.name
      ORDER BY total_debt DESC
    `;

    const ageingTotals = await this.tenantPrisma.db.$queryRaw<
      { not_overdue: unknown; d1_7: unknown; d8_30: unknown; d30_plus: unknown }[]
    >`
      SELECT SUM(not_overdue) AS not_overdue, SUM(d1_7) AS d1_7, SUM(d8_30) AS d8_30, SUM(d30_plus) AS d30_plus
      FROM v_debt_ageing WHERE tenant_id = ${tenantId}::uuid
    `;

    const totals = ageingTotals[0];

    return {
      byGroup: byGroup.map((r) => ({
        groupId: r.group_id,
        groupName: r.group_name,
        totalDebtTiyin: toBigInt(r.total_debt).toString(),
      })),
      ageing: {
        notOverdue: toBigInt(totals?.not_overdue).toString(),
        d1_7: toBigInt(totals?.d1_7).toString(),
        d8_30: toBigInt(totals?.d8_30).toString(),
        d30plus: toBigInt(totals?.d30_plus).toString(),
      },
    };
  }
}
