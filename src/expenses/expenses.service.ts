import { Injectable } from '@nestjs/common';
import { TenantPrisma } from '../prisma/tenant-prisma.provider';
import { AuditService } from '../audit/audit.service';
import { AppErrors } from '../common/exceptions/app.exception';
import { AuthContext } from '../common/auth-context';
import { CreateExpenseDto, PayExpenseDto, UpdateExpenseDto } from './dto/expense.dto';

@Injectable()
export class ExpensesService {
  constructor(
    private readonly tenantPrisma: TenantPrisma,
    private readonly audit: AuditService,
  ) {}

  list(filters: { year?: number; month?: number; type?: string; status?: string }) {
    const where: Record<string, unknown> = this.tenantPrisma.branchWhere('expense:read');
    if (filters.year) where.billingYear = filters.year;
    if (filters.month) where.billingMonth = filters.month;
    if (filters.type) where.expenseType = filters.type;
    if (filters.status) where.status = filters.status;
    return this.tenantPrisma.db.expense.findMany({
      where,
      orderBy: [{ billingYear: 'desc' }, { billingMonth: 'desc' }],
    });
  }

  async findOneOrThrow(id: string, permission = 'expense:read') {
    const expense = await this.tenantPrisma.db.expense.findFirst({
      where: { id, ...this.tenantPrisma.branchWhere(permission) },
    });
    if (!expense) throw AppErrors.notFound('Expense not found');
    return expense;
  }

  async create(ctx: AuthContext, dto: CreateExpenseDto) {
    return this.tenantPrisma.transaction(async () => {
      if (dto.branchId) await this.tenantPrisma.assertBranch(dto.branchId, 'expense:manage');
      else if (ctx.scopeFor('expense:manage') !== 'all') throw AppErrors.outOfScope();
      const expense = await this.tenantPrisma.db.expense.create({
        data: {
          tenantId: this.tenantPrisma.tenantId,
          branchId: dto.branchId,
          expenseType: dto.type,
          provider: dto.provider,
          contractNumber: dto.contractNumber,
          billingYear: dto.billingYear,
          billingMonth: dto.billingMonth,
          invoiceNumber: dto.invoiceNumber,
          amountTiyin: BigInt(dto.amountTiyin),
          dueDate: dto.dueDate ? new Date(dto.dueDate) : null,
          attachmentFileId: dto.attachmentFileId,
          note: dto.note,
          createdBy: ctx.userId,
        },
      });

      await this.audit.log({
        userId: ctx.userId,
        action: 'expense.create',
        entityType: 'expense',
        entityId: expense.id,
        newValue: { expenseType: expense.expenseType, amountTiyin: expense.amountTiyin.toString() },
      });

      return expense;
    });
  }

  async update(ctx: AuthContext, id: string, dto: UpdateExpenseDto) {
    return this.tenantPrisma.transaction(async () => {
      const before = await this.findOneOrThrow(id, 'expense:manage');
      if (before.status !== 'unpaid') {
        throw AppErrors.conflict('Only an unpaid expense can be edited');
      }

      const updated = await this.tenantPrisma.db.expense.update({
        where: { id, status: 'unpaid' },
        data: {
          provider: dto.provider,
          amountTiyin: dto.amountTiyin !== undefined ? BigInt(dto.amountTiyin) : undefined,
          dueDate: dto.dueDate ? new Date(dto.dueDate) : undefined,
          note: dto.note,
        },
      });

      await this.audit.log({
        userId: ctx.userId,
        action: 'expense.create',
        entityType: 'expense',
        entityId: id,
        oldValue: { amountTiyin: before.amountTiyin.toString() },
        newValue: { amountTiyin: updated.amountTiyin.toString() },
      });

      return updated;
    });
  }

  async pay(ctx: AuthContext, id: string, dto: PayExpenseDto) {
    return this.tenantPrisma.transaction(async () => {
      const expense = await this.findOneOrThrow(id, 'expense:manage');
      if (expense.status === 'paid') throw AppErrors.conflict('Expense is already paid');
      if (expense.status === 'cancelled')
        throw AppErrors.conflict('Cannot pay a cancelled expense');

      if (BigInt(dto.amountTiyin) !== expense.amountTiyin)
        throw AppErrors.validationFailed('Expense payments must settle the full amount');
      const updated = await this.tenantPrisma.db.expense.update({
        where: { id, status: 'unpaid', amountTiyin: expense.amountTiyin },
        data: {
          status: 'paid',
          paidAt: new Date(dto.paidAt),
          paidAmountTiyin: BigInt(dto.amountTiyin),
          attachmentFileId: dto.attachmentFileId ?? expense.attachmentFileId,
        },
      });

      await this.audit.log({
        userId: ctx.userId,
        action: 'expense.pay',
        entityType: 'expense',
        entityId: id,
        newValue: { paidAt: dto.paidAt, amountTiyin: dto.amountTiyin },
      });

      return updated;
    });
  }

  async summary(year: number) {
    const expenses = await this.tenantPrisma.db.expense.findMany({
      where: {
        billingYear: year,
        status: { not: 'cancelled' },
        ...this.tenantPrisma.branchWhere('expense:read'),
      },
    });
    const byMonth = new Map<number, { total: bigint; paid: bigint; unpaid: bigint }>();
    for (const e of expenses) {
      const entry = byMonth.get(e.billingMonth) ?? { total: 0n, paid: 0n, unpaid: 0n };
      entry.total += e.amountTiyin;
      if (e.status === 'paid') entry.paid += e.paidAmountTiyin ?? e.amountTiyin;
      else if (e.status === 'unpaid') entry.unpaid += e.amountTiyin;
      byMonth.set(e.billingMonth, entry);
    }
    return [...byMonth.entries()]
      .sort(([a], [b]) => a - b)
      .map(([month, v]) => ({
        month,
        totalTiyin: v.total.toString(),
        paidTiyin: v.paid.toString(),
        unpaidTiyin: v.unpaid.toString(),
      }));
  }
}
