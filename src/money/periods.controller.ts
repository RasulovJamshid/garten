import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PeriodsService } from './periods.service';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { Auth } from '../common/decorators/auth.decorator';
import { AuthContext } from '../common/auth-context';
import { CreatePeriodDto, ReopenPeriodDto } from './dto/period.dto';

@ApiTags('periods')
@Controller('periods')
export class PeriodsController {
  constructor(private readonly periods: PeriodsService) {}

  @ApiOperation({
    summary: 'List billing periods',
    description: 'Filterable by year.',
  })
  @Get()
  @RequirePermissions('charge:read')
  list(@Query('year') year?: string) {
    return this.periods.list(year ? Number(year) : undefined);
  }

  @ApiOperation({
    summary: 'Create a billing period',
  })
  @Post()
  @RequirePermissions('charge:generate')
  create(@Auth() ctx: AuthContext, @Body() dto: CreatePeriodDto) {
    return this.periods.create(ctx, dto);
  }

  @ApiOperation({
    summary: 'Close a billing period',
    description: 'Locks the period against further charge generation. Requires period:close.',
  })
  @Post(':id/close')
  @RequirePermissions('period:close')
  close(@Auth() ctx: AuthContext, @Param('id') id: string) {
    return this.periods.close(ctx, id);
  }

  @ApiOperation({
    summary: 'Reopen a closed billing period',
    description:
      "Requires period:reopen — a sensitive permission deliberately excluded from most roles' " +
      'default grants (see prisma/seed.ts), since reopening a closed financial period should be ' +
      'rare and auditable.',
  })
  @Post(':id/reopen')
  @RequirePermissions('period:reopen')
  reopen(@Auth() ctx: AuthContext, @Param('id') id: string, @Body() dto: ReopenPeriodDto) {
    return this.periods.reopen(ctx, id, dto);
  }
}
