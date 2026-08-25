import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { TariffsService } from './tariffs.service';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { Auth } from '../common/decorators/auth.decorator';
import { AuthContext } from '../common/auth-context';
import { CreateTariffDto, UpdateTariffDto } from './dto/tariff.dto';
import { AssignChildTariffDto } from './dto/child-tariff.dto';

@ApiTags('tariffs')
@Controller()
export class TariffsController {
  constructor(private readonly tariffs: TariffsService) {}

  @Get('tariffs')
  @RequirePermissions('charge:read')
  list(@Query('active') active?: string) {
    return this.tariffs.list(active === undefined ? undefined : active === 'true');
  }

  @Post('tariffs')
  @RequirePermissions('tariff:manage')
  create(@Auth() ctx: AuthContext, @Body() dto: CreateTariffDto) {
    return this.tariffs.create(ctx, dto);
  }

  @Patch('tariffs/:id')
  @RequirePermissions('tariff:manage')
  update(@Auth() ctx: AuthContext, @Param('id') id: string, @Body() dto: UpdateTariffDto) {
    return this.tariffs.update(ctx, id, dto);
  }

  @Get('children/:childId/tariffs')
  @RequirePermissions('charge:read')
  tariffsOfChild(@Param('childId') childId: string) {
    return this.tariffs.tariffsOfChild(childId);
  }

  @Post('children/:childId/tariffs')
  @RequirePermissions('tariff:manage')
  assign(
    @Auth() ctx: AuthContext,
    @Param('childId') childId: string,
    @Body() dto: AssignChildTariffDto,
  ) {
    return this.tariffs.assignToChild(ctx, childId, dto);
  }
}
