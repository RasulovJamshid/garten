import { Injectable } from '@nestjs/common';
import { TenantPrisma } from '../prisma/tenant-prisma.provider';
import { AuthContext } from '../common/auth-context';
import { todayInTashkent } from '../common/tashkent-date';
import { AttendanceService } from '../attendance/attendance.service';
import { DebtsService } from '../debts/debts.service';
import { ExpensesService } from '../expenses/expenses.service';
import { TelegramBindingService } from '../telegram/telegram-binding.service';

/**
 * One aggregate call per role screen (api-spec §11 — "any consumer needs
 * one cheap call rather than fifteen"). The exact tile set isn't in the
 * provided docs (the spec references "the original spec" for tiles
 * without including it), so this is a reasonable Stage 1 default built
 * from what's already tracked elsewhere, not a literal reproduction of an
 * unseen mockup.
 */
@Injectable()
export class DashboardService {
  constructor(
    private readonly tenantPrisma: TenantPrisma,
    private readonly attendance: AttendanceService,
    private readonly debts: DebtsService,
    private readonly expenses: ExpensesService,
    private readonly telegramBinding: TelegramBindingService,
  ) {}

  async director(ctx: AuthContext) {
    const today = todayInTashkent();
    const [
      activeChildren,
      inside,
      absentToday,
      debtSummary,
      guardianCount,
      boundCount,
      monthExpenses,
    ] = await Promise.all([
      this.tenantPrisma.db.child.count({ where: { status: 'active' } }),
      this.attendance.inside(ctx),
      this.attendance.absent(ctx, today),
      this.debts.summary(),
      this.tenantPrisma.db.guardian.count({ where: { deletedAt: null } }),
      this.tenantPrisma.db.telegramBinding.count({
        where: { tenantId: ctx.tenantId, unboundAt: null },
      }),
      this.expenses.summary(new Date(today).getFullYear()),
    ]);

    const thisMonth = new Date(today).getMonth() + 1;
    const paymentsThisMonth = await this.tenantPrisma.db.payment.aggregate({
      where: { sign: 1, paidAt: { gte: new Date(`${today.slice(0, 7)}-01`) } },
      _sum: { amountTiyin: true },
    });

    return {
      activeChildren,
      currentlyInside: inside.length,
      absentToday: absentToday.length,
      debt: debtSummary,
      telegramBoundRate: guardianCount > 0 ? Math.round((boundCount / guardianCount) * 100) : 0,
      telegramBound: boundCount,
      telegramGuardianTotal: guardianCount,
      revenueThisMonthTiyin: (paymentsThisMonth._sum.amountTiyin ?? 0n).toString(),
      expensesThisMonthTiyin: monthExpenses.find((m) => m.month === thisMonth)?.totalTiyin ?? '0',
    };
  }

  async accountant() {
    const today = todayInTashkent();
    const startOfMonth = new Date(`${today.slice(0, 7)}-01`);

    const [paymentsToday, chargesThisMonth, debtSummary, unpaidExpenses, openPeriod] =
      await Promise.all([
        this.tenantPrisma.db.payment.aggregate({
          where: { sign: 1, paidAt: { gte: new Date(today) } },
          _sum: { amountTiyin: true },
          _count: true,
        }),
        this.tenantPrisma.db.charge.aggregate({
          where: { sign: 1, issuedAt: { gte: startOfMonth } },
          _sum: { amountTiyin: true },
        }),
        this.debts.summary(),
        this.tenantPrisma.db.expense.aggregate({
          where: { status: 'unpaid' },
          _sum: { amountTiyin: true },
          _count: true,
        }),
        this.tenantPrisma.db.accountingPeriod.findFirst({
          where: { status: 'open' },
          orderBy: [{ year: 'desc' }, { month: 'desc' }],
        }),
      ]);

    return {
      paymentsToday: {
        count: paymentsToday._count,
        totalTiyin: (paymentsToday._sum.amountTiyin ?? 0n).toString(),
      },
      chargesThisMonthTiyin: (chargesThisMonth._sum.amountTiyin ?? 0n).toString(),
      debt: debtSummary,
      unpaidExpenses: {
        count: unpaidExpenses._count,
        totalTiyin: (unpaidExpenses._sum.amountTiyin ?? 0n).toString(),
      },
      openPeriod: openPeriod
        ? { id: openPeriod.id, year: openPeriod.year, month: openPeriod.month }
        : null,
    };
  }

  async reception(ctx: AuthContext) {
    const [inside, absentToday, notPickedUp, unboundGuardians] = await Promise.all([
      this.attendance.inside(ctx),
      this.attendance.absent(ctx, todayInTashkent()),
      this.attendance.notPickedUp(ctx),
      this.telegramBinding.listUnboundGuardians(ctx.tenantId),
    ]);

    return {
      currentlyInside: inside.length,
      absentToday: absentToday.length,
      notPickedUpYet: notPickedUp.length,
      unboundGuardianCount: unboundGuardians.length,
    };
  }
}
