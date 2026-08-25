import { Body, Controller, Delete, Get, Param, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { TenantPrisma } from '../prisma/tenant-prisma.provider';
import { AuditService } from '../audit/audit.service';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { Auth } from '../common/decorators/auth.decorator';
import { AuthContext } from '../common/auth-context';
import { AppErrors } from '../common/exceptions/app.exception';
import { CreateHolidayDto } from './dto/holiday.dto';

@ApiTags('holidays')
@Controller('holidays')
@RequirePermissions('holiday:manage')
export class HolidaysController {
  constructor(
    private readonly tenantPrisma: TenantPrisma,
    private readonly audit: AuditService,
  ) {}

  @Get()
  list(@Query('year') year?: string, @Query('branchId') branchId?: string) {
    const where: Record<string, unknown> = {};
    if (year) {
      where.holidayDate = {
        gte: new Date(`${year}-01-01`),
        lt: new Date(`${Number(year) + 1}-01-01`),
      };
    }
    if (branchId) where.branchId = branchId;
    return this.tenantPrisma.db.holiday.findMany({ where, orderBy: { holidayDate: 'asc' } });
  }

  @Post()
  async create(@Auth() ctx: AuthContext, @Body() dto: CreateHolidayDto) {
    const holiday = await this.tenantPrisma.db.holiday.create({
      data: {
        tenantId: this.tenantPrisma.tenantId,
        branchId: dto.branchId,
        holidayDate: new Date(dto.holidayDate),
        name: dto.name,
        isWorking: dto.isWorking ?? false,
      },
    });
    await this.audit.log({
      userId: ctx.userId,
      action: 'settings.update',
      entityType: 'holiday',
      entityId: holiday.id,
      newValue: { holidayDate: dto.holidayDate, name: dto.name },
    });
    return holiday;
  }

  @Delete(':id')
  async remove(@Auth() ctx: AuthContext, @Param('id') id: string) {
    const holiday = await this.tenantPrisma.db.holiday.findUnique({ where: { id } });
    if (!holiday) throw AppErrors.notFound('Holiday not found');
    await this.tenantPrisma.db.holiday.delete({ where: { id } });
    await this.audit.log({
      userId: ctx.userId,
      action: 'settings.update',
      entityType: 'holiday',
      entityId: id,
      oldValue: { name: holiday.name },
    });
  }
}
