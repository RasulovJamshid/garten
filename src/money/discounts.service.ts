import { Injectable } from '@nestjs/common';
import { TenantPrisma } from '../prisma/tenant-prisma.provider';
import { AuditService } from '../audit/audit.service';
import { AppErrors } from '../common/exceptions/app.exception';
import { AuthContext } from '../common/auth-context';
import { CreateDiscountDto, parseDiscountValue } from './dto/discount.dto';

function dateOnly(iso: string): Date {
  return new Date(iso);
}

@Injectable()
export class DiscountsService {
  constructor(
    private readonly tenantPrisma: TenantPrisma,
    private readonly audit: AuditService,
  ) {}

  listForChild(childId: string) {
    return this.tenantPrisma.db.discount.findMany({
      where: { childId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async create(ctx: AuthContext, childId: string, dto: CreateDiscountDto) {
    const child = await this.tenantPrisma.db.child.findUnique({ where: { id: childId } });
    if (!child) throw AppErrors.notFound('Child not found');

    let parsed: { valueTiyin?: bigint; valueBp?: number };
    try {
      parsed = parseDiscountValue(dto);
    } catch (e) {
      throw AppErrors.validationFailed((e as Error).message);
    }

    const discount = await this.tenantPrisma.db.discount.create({
      data: {
        tenantId: this.tenantPrisma.tenantId,
        childId,
        kind: dto.kind,
        valueTiyin: parsed.valueTiyin,
        valueBp: parsed.valueBp,
        validFrom: dateOnly(dto.validFrom),
        validTo: dto.validTo ? dateOnly(dto.validTo) : null,
        reason: dto.reason,
        approvedBy: ctx.userId,
      },
    });

    await this.audit.log({
      userId: ctx.userId,
      action: 'discount.create',
      entityType: 'discount',
      entityId: discount.id,
      newValue: {
        childId,
        kind: dto.kind,
        value: dto.value,
        reason: dto.reason,
      },
    });

    return discount;
  }

  async revoke(ctx: AuthContext, id: string) {
    const discount = await this.tenantPrisma.db.discount.findUnique({ where: { id } });
    if (!discount) throw AppErrors.notFound('Discount not found');

    const updated = await this.tenantPrisma.db.discount.update({
      where: { id },
      data: { revokedAt: new Date() },
    });

    await this.audit.log({
      userId: ctx.userId,
      action: 'discount.revoke',
      entityType: 'discount',
      entityId: id,
    });

    return updated;
  }

  /** Active (non-revoked, in-window) discounts for a child on a given date — used by the billing engine. */
  async activeDiscountsFor(childId: string, onDate: Date) {
    return this.tenantPrisma.db.discount.findMany({
      where: {
        childId,
        revokedAt: null,
        validFrom: { lte: onDate },
        OR: [{ validTo: null }, { validTo: { gte: onDate } }],
      },
    });
  }
}
