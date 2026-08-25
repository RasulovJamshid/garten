import { Injectable } from '@nestjs/common';
import { TenantPrisma } from '../prisma/tenant-prisma.provider';
import { AuditService } from '../audit/audit.service';
import { AppErrors } from '../common/exceptions/app.exception';
import { AuthContext } from '../common/auth-context';
import { CreatePeriodDto, ReopenPeriodDto } from './dto/period.dto';

@Injectable()
export class PeriodsService {
  constructor(
    private readonly tenantPrisma: TenantPrisma,
    private readonly audit: AuditService,
  ) {}

  list(year?: number) {
    return this.tenantPrisma.db.accountingPeriod.findMany({
      where: year ? { year } : {},
      orderBy: [{ year: 'desc' }, { month: 'desc' }],
    });
  }

  async findOneOrThrow(id: string) {
    const period = await this.tenantPrisma.db.accountingPeriod.findUnique({ where: { id } });
    if (!period) throw AppErrors.notFound('PERIOD_NOT_FOUND');
    return period;
  }

  async findByYearMonth(year: number, month: number) {
    return this.tenantPrisma.db.accountingPeriod.findUnique({
      where: { tenantId_year_month: { tenantId: this.tenantPrisma.tenantId, year, month } },
    });
  }

  async create(ctx: AuthContext, dto: CreatePeriodDto) {
    const existing = await this.findByYearMonth(dto.year, dto.month);
    if (existing) throw AppErrors.duplicate('Period already exists', existing);

    return this.tenantPrisma.db.accountingPeriod.create({
      data: { tenantId: this.tenantPrisma.tenantId, year: dto.year, month: dto.month },
    });
  }

  /** Idempotent — returns the existing open/closed period rather than erroring, for callers that just need "the period for this month" to exist. */
  async getOrCreate(year: number, month: number) {
    const existing = await this.findByYearMonth(year, month);
    if (existing) return existing;
    return this.tenantPrisma.db.accountingPeriod.create({
      data: { tenantId: this.tenantPrisma.tenantId, year, month },
    });
  }

  async close(ctx: AuthContext, id: string) {
    const period = await this.findOneOrThrow(id);
    if (period.status === 'closed') throw AppErrors.conflict('Period is already closed');

    const updated = await this.tenantPrisma.db.accountingPeriod.update({
      where: { id },
      data: { status: 'closed', closedAt: new Date(), closedBy: ctx.userId },
    });

    await this.audit.log({
      userId: ctx.userId,
      action: 'period.close',
      entityType: 'accounting_period',
      entityId: id,
      newValue: { year: period.year, month: period.month },
    });

    return updated;
  }

  async reopen(ctx: AuthContext, id: string, dto: ReopenPeriodDto) {
    const period = await this.findOneOrThrow(id);
    if (period.status === 'open') throw AppErrors.conflict('Period is already open');

    const updated = await this.tenantPrisma.db.accountingPeriod.update({
      where: { id },
      data: {
        status: 'open',
        reopenedAt: new Date(),
        reopenedBy: ctx.userId,
        reopenReason: dto.reason,
      },
    });

    await this.audit.log({
      userId: ctx.userId,
      action: 'period.reopen',
      entityType: 'accounting_period',
      entityId: id,
      newValue: { year: period.year, month: period.month, reason: dto.reason },
    });

    return updated;
  }
}
