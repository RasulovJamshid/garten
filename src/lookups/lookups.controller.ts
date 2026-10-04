import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { todayInTashkent } from '../common/tashkent-date';
import { TenantPrisma } from '../prisma/tenant-prisma.provider';
import { AppErrors } from '../common/exceptions/app.exception';
import { ChildLookupDto } from './child-lookup.dto';

@ApiTags('lookups')
@Controller('lookups')
export class LookupsController {
  constructor(private readonly prisma: TenantPrisma) {}

  @Get('children')
  @ApiOperation({
    summary: 'Minimal child names for an authorized operation',
    description:
      'Requires the selected permission and applies its child scope. Returns IDs and names only.',
  })
  async children(@Query() dto: ChildLookupDto) {
    const at = new Date(todayInTashkent());
    const where = {
      AND: [
        this.prisma.childWhere(dto.permission),
        {
          deletedAt: null,
          ...(dto.branchId ? { branchId: dto.branchId } : {}),
          ...(dto.q
            ? {
                OR: [
                  { firstName: { contains: dto.q, mode: 'insensitive' as const } },
                  { lastName: { contains: dto.q, mode: 'insensitive' as const } },
                ],
              }
            : {}),
          ...(dto.groupId
            ? {
                groupAssignment: {
                  some: {
                    groupId: dto.groupId,
                    effectiveFrom: { lte: at },
                    OR: [{ effectiveTo: null }, { effectiveTo: { gte: at } }],
                  },
                },
              }
            : {}),
        },
      ],
    };
    const [data, total] = await Promise.all([
      this.prisma.db.child.findMany({
        where,
        select: { id: true, firstName: true, lastName: true, branchId: true },
        orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }, { id: 'asc' }],
        skip: (dto.page - 1) * dto.limit,
        take: dto.limit,
      }),
      this.prisma.db.child.count({ where }),
    ]);
    return {
      data,
      meta: { page: dto.page, limit: dto.limit, total, pages: Math.ceil(total / dto.limit) },
    };
  }

  @Get('children/:id/pickup-guardians')
  @ApiOperation({ summary: 'Linked guardians for pickup within the selected permission scope' })
  async pickupGuardians(@Param('id', ParseUUIDPipe) id: string, @Query() dto: ChildLookupDto) {
    if (!['pickup:read', 'pickup:manage', 'pickup:temporary'].includes(dto.permission))
      throw AppErrors.forbidden();
    await this.prisma.assertChild(id, dto.permission);
    const links = await this.prisma.db.childGuardian.findMany({
      where: { childId: id, guardian: { deletedAt: null } },
      select: {
        relationship: true,
        guardian: { select: { id: true, fullName: true, phone: true } },
      },
      orderBy: { guardian: { fullName: 'asc' } },
    });
    return links.map((link) => ({ ...link.guardian, relationship: link.relationship }));
  }

  @Get('children/:id/payers')
  @RequirePermissions('payment:create')
  @ApiOperation({ summary: 'Linked payer names within payment creation scope' })
  async payers(@Param('id', ParseUUIDPipe) id: string) {
    await this.prisma.assertChild(id, 'payment:create');
    const links = await this.prisma.db.childGuardian.findMany({
      where: { childId: id, guardian: { deletedAt: null } },
      select: { guardian: { select: { id: true, fullName: true } } },
      orderBy: { guardian: { fullName: 'asc' } },
    });
    return links.map((link) => link.guardian);
  }
}
