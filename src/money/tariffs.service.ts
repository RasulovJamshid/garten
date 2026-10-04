import { Injectable } from '@nestjs/common';
import { TenantPrisma } from '../prisma/tenant-prisma.provider';
import { AuditService } from '../audit/audit.service';
import { AppErrors } from '../common/exceptions/app.exception';
import { AuthContext } from '../common/auth-context';
import { CreateTariffDto, UpdateTariffDto } from './dto/tariff.dto';
import { AssignChildTariffDto } from './dto/child-tariff.dto';

function dateOnly(iso: string): Date {
  return new Date(iso);
}

@Injectable()
export class TariffsService {
  constructor(
    private readonly tenantPrisma: TenantPrisma,
    private readonly audit: AuditService,
  ) {}

  list(active?: boolean) {
    return this.tenantPrisma.db.tariff.findMany({
      where: active === undefined ? {} : { active },
      orderBy: { name: 'asc' },
    });
  }

  async create(ctx: AuthContext, dto: CreateTariffDto) {
    const tariff = await this.tenantPrisma.db.tariff.create({
      data: {
        tenantId: this.tenantPrisma.tenantId,
        branchId: dto.branchId,
        name: dto.name,
        kind: dto.kind,
        amountTiyin: BigInt(dto.amountTiyin),
        createdBy: ctx.userId,
      },
    });

    await this.audit.log({
      userId: ctx.userId,
      action: 'tariff.change',
      entityType: 'tariff',
      entityId: tariff.id,
      newValue: {
        name: tariff.name,
        kind: tariff.kind,
        amountTiyin: tariff.amountTiyin.toString(),
      },
    });

    return tariff;
  }

  async update(ctx: AuthContext, id: string, dto: UpdateTariffDto) {
    const before = await this.tenantPrisma.db.tariff.findUnique({ where: { id } });
    if (!before) throw AppErrors.notFound('Tariff not found');

    const updated = await this.tenantPrisma.db.tariff.update({
      where: { id },
      data: {
        name: dto.name,
        amountTiyin: dto.amountTiyin !== undefined ? BigInt(dto.amountTiyin) : undefined,
        active: dto.active,
      },
    });

    await this.audit.log({
      userId: ctx.userId,
      action: 'tariff.change',
      entityType: 'tariff',
      entityId: id,
      oldValue: {
        name: before.name,
        amountTiyin: before.amountTiyin.toString(),
        active: before.active,
      },
      newValue: {
        name: updated.name,
        amountTiyin: updated.amountTiyin.toString(),
        active: updated.active,
      },
    });

    return updated;
  }

  async tariffsOfChild(childId: string) {
    await this.tenantPrisma.assertChild(childId, 'tariff:manage');
    return this.tenantPrisma.db.childTariff.findMany({
      where: { childId },
      include: { tariff: true },
      orderBy: { effectiveFrom: 'desc' },
    });
  }

  /** Tariff changes affect future periods only — existing charges keep their tariffSnapshot (api-spec §9). */
  async assignToChild(ctx: AuthContext, childId: string, dto: AssignChildTariffDto) {
    const child = await this.tenantPrisma.assertChild(childId, 'tariff:manage');
    if (!child) throw AppErrors.notFound('Child not found');
    const tariff = await this.tenantPrisma.db.tariff.findUnique({ where: { id: dto.tariffId } });
    if (!tariff) throw AppErrors.notFound('Tariff not found');
    if (tariff.branchId && tariff.branchId !== child.branchId)
      throw AppErrors.validationFailed('Tariff belongs to a different branch');
    if (!tariff.active) throw AppErrors.validationFailed('Tariff is inactive');
    const start = dateOnly(dto.effectiveFrom);
    const end = dto.effectiveTo ? dateOnly(dto.effectiveTo) : null;
    if (end && end < start) throw AppErrors.validationFailed('effectiveTo precedes effectiveFrom');

    const assignment = await this.tenantPrisma.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM child WHERE id = ${childId}::uuid AND tenant_id = ${ctx.tenantId}::uuid FOR UPDATE`;
      const billed = await tx.charge.findFirst({
        where: {
          childId,
          sign: 1,
          kind: tariff.kind,
          accountingPeriod: { year: start.getUTCFullYear(), month: start.getUTCMonth() + 1 },
        },
      });
      if (billed)
        throw AppErrors.conflict(
          'TARIFF_PERIOD_ALREADY_BILLED: use a financial adjustment for a billed period',
        );
      const overlapping = await tx.childTariff.findMany({
        where: {
          childId,
          tariff: { kind: tariff.kind },
          ...(end ? { effectiveFrom: { lte: end } } : {}),
          OR: [{ effectiveTo: null }, { effectiveTo: { gte: start } }],
        },
      });
      for (const prior of overlapping) {
        if (prior.effectiveFrom >= start)
          throw AppErrors.conflict(
            'TARIFF_OVERLAP: an assignment already starts within the requested range',
          );
        await tx.childTariff.update({
          where: { id: prior.id },
          data: { effectiveTo: new Date(start.getTime() - 86400000) },
        });
      }
      return tx.childTariff.create({
        data: {
          tenantId: this.tenantPrisma.tenantId,
          childId,
          tariffId: dto.tariffId,
          effectiveFrom: dateOnly(dto.effectiveFrom),
          effectiveTo: dto.effectiveTo ? dateOnly(dto.effectiveTo) : null,
          assignedBy: ctx.userId,
        },
      });
    });

    await this.audit.log({
      userId: ctx.userId,
      action: 'tariff.change',
      entityType: 'child',
      entityId: childId,
      newValue: { tariffId: dto.tariffId, effectiveFrom: dto.effectiveFrom },
    });

    return assignment;
  }

  async endAssignment(
    ctx: AuthContext,
    childId: string,
    assignmentId: string,
    effectiveTo: string,
  ) {
    await this.tenantPrisma.assertChild(childId, 'tariff:manage');
    const assignment = await this.tenantPrisma.db.childTariff.findFirst({
      where: { id: assignmentId, childId },
    });
    if (!assignment) throw AppErrors.notFound('Tariff assignment not found');
    const end = dateOnly(effectiveTo);
    if (end < assignment.effectiveFrom)
      throw AppErrors.validationFailed('effectiveTo precedes effectiveFrom');
    const period = await this.tenantPrisma.db.accountingPeriod.findFirst({
      where: {
        year: end.getUTCFullYear(),
        month: end.getUTCMonth() + 1,
        OR: [{ status: 'closed' }, { billingRun: { some: { status: 'committed' } } }],
      },
    });
    if (period) throw AppErrors.conflict('TARIFF_PERIOD_ALREADY_BILLED');
    const updated = await this.tenantPrisma.db.childTariff.update({
      where: { id: assignmentId },
      data: { effectiveTo: end },
    });
    await this.audit.log({
      userId: ctx.userId,
      action: 'tariff.change',
      entityType: 'child',
      entityId: childId,
      newValue: { assignmentId, effectiveTo },
    });
    return updated;
  }

  /** The tariff in effect for a child on a given date — used by /billing-rules/simulate. */
  async activeTariffFor(childId: string, onDate: Date) {
    return this.tenantPrisma.db.childTariff.findFirst({
      where: {
        childId,
        effectiveFrom: { lte: onDate },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: onDate } }],
      },
      include: { tariff: true },
      orderBy: { effectiveFrom: 'desc' },
    });
  }

  /**
   * ALL tariffs in effect for a child on a given date — a child can carry
   * more than one concurrently (tuition + meal + transport, each its own
   * kind). The billing run charges every one of them separately.
   */
  async activeTariffsFor(
    childId: string,
    onDate: Date,
    until = onDate,
    db: any = this.tenantPrisma.db,
  ) {
    return db.childTariff.findMany({
      where: {
        childId,
        effectiveFrom: { lte: until },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: onDate } }],
      },
      include: { tariff: true },
    });
  }

  /** Every child with at least one active tariff assignment on a date — the billing run's candidate set. */
  async childrenWithActiveTariffs(onDate: Date, until = onDate, db: any = this.tenantPrisma.db) {
    const rows: { childId: string }[] = await db.childTariff.findMany({
      where: {
        effectiveFrom: { lte: until },
        child: { deletedAt: null },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: onDate } }],
      },
      select: { childId: true },
      distinct: ['childId'],
    });
    return rows.map((r) => r.childId);
  }
}
