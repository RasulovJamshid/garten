import { Body, Controller, Get, Put } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { TenantPrisma } from '../prisma/tenant-prisma.provider';
import { AuditService } from '../audit/audit.service';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { Auth } from '../common/decorators/auth.decorator';
import { AuthContext } from '../common/auth-context';
import { UpdateSettingsDto } from './dto/update-settings.dto';

@ApiTags('settings')
@Controller('settings')
export class SettingsController {
  constructor(
    private readonly tenantPrisma: TenantPrisma,
    private readonly audit: AuditService,
  ) {}

  @ApiOperation({
    summary: 'Get tenant settings',
    description: 'The single settings row for this tenant (timezone, language, currency, etc).',
  })
  @Get()
  @RequirePermissions('settings:manage')
  async get() {
    return this.tenantPrisma.db.setting.findUniqueOrThrow({
      where: { tenantId: this.tenantPrisma.tenantId },
    });
  }

  @ApiOperation({
    summary: 'Update tenant settings',
  })
  @Put()
  @RequirePermissions('settings:manage')
  async update(@Auth() ctx: AuthContext, @Body() dto: UpdateSettingsDto) {
    const before = await this.tenantPrisma.db.setting.findUnique({
      where: { tenantId: ctx.tenantId },
    });

    const updated = await this.tenantPrisma.db.setting.update({
      where: { tenantId: ctx.tenantId },
      data: { ...dto, updatedBy: ctx.userId },
    });

    await this.audit.log({
      userId: ctx.userId,
      action: 'settings.update',
      entityType: 'setting',
      entityId: ctx.tenantId,
      oldValue: before ?? undefined,
      newValue: updated,
    });

    return updated;
  }
}
