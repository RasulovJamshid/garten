import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { TenantPrisma } from '../prisma/tenant-prisma.provider';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { AppErrors } from '../common/exceptions/app.exception';

/**
 * Append-only, read-only. No write endpoints exist here on purpose
 * (api-spec §12). Owner + Director only, via audit:read.
 */
@ApiTags('audit')
@Controller('audit')
export class AuditController {
  constructor(private readonly tenantPrisma: TenantPrisma) {}

  @Get()
  @RequirePermissions('audit:read')
  async list(
    @Query('entity') entityType?: string,
    @Query('entityId') entityId?: string,
    @Query('userId') userId?: string,
    @Query('action') action?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('page') page = '1',
    @Query('limit') limit = '50',
  ) {
    const take = Math.min(Number(limit) || 50, 200);
    const skip = (Math.max(Number(page) || 1, 1) - 1) * take;

    const where = {
      ...(entityType && { entityType }),
      ...(entityId && { entityId }),
      ...(userId && { userId }),
      ...(action && { action }),
      ...((from || to) && {
        occurredAt: {
          ...(from && { gte: new Date(from) }),
          ...(to && { lte: new Date(to) }),
        },
      }),
    };

    const [data, total] = await Promise.all([
      this.tenantPrisma.db.auditLog.findMany({
        where,
        orderBy: { occurredAt: 'desc' },
        take,
        skip,
      }),
      this.tenantPrisma.db.auditLog.count({ where }),
    ]);

    return {
      data,
      meta: { page: Number(page) || 1, limit: take, total, pages: Math.ceil(total / take) },
    };
  }

  @Get(':id')
  @RequirePermissions('audit:read')
  async get(@Param('id') id: string) {
    const row = await this.tenantPrisma.db.auditLog.findUnique({ where: { id: BigInt(id) } });
    if (!row) throw AppErrors.notFound();
    return row;
  }
}
