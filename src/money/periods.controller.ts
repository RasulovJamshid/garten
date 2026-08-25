import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PeriodsService } from './periods.service';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { Auth } from '../common/decorators/auth.decorator';
import { AuthContext } from '../common/auth-context';
import { CreatePeriodDto, ReopenPeriodDto } from './dto/period.dto';

@ApiTags('periods')
@Controller('periods')
export class PeriodsController {
  constructor(private readonly periods: PeriodsService) {}

  @Get()
  @RequirePermissions('charge:read')
  list(@Query('year') year?: string) {
    return this.periods.list(year ? Number(year) : undefined);
  }

  @Post()
  @RequirePermissions('charge:generate')
  create(@Auth() ctx: AuthContext, @Body() dto: CreatePeriodDto) {
    return this.periods.create(ctx, dto);
  }

  @Post(':id/close')
  @RequirePermissions('period:close')
  close(@Auth() ctx: AuthContext, @Param('id') id: string) {
    return this.periods.close(ctx, id);
  }

  @Post(':id/reopen')
  @RequirePermissions('period:reopen')
  reopen(@Auth() ctx: AuthContext, @Param('id') id: string, @Body() dto: ReopenPeriodDto) {
    return this.periods.reopen(ctx, id, dto);
  }
}
