import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
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

  @ApiOperation({
    summary: 'List tariffs',
    description: 'Filterable by active status.',
  })
  @Get('tariffs')
  @RequirePermissions('charge:read')
  list(@Query('active') active?: string) {
    return this.tariffs.list(active === undefined ? undefined : active === 'true');
  }

  @ApiOperation({
    summary: 'Create a tariff',
  })
  @Post('tariffs')
  @RequirePermissions('tariff:manage')
  create(@Auth() ctx: AuthContext, @Body() dto: CreateTariffDto) {
    return this.tariffs.create(ctx, dto);
  }

  @ApiOperation({
    summary: 'Update a tariff',
  })
  @Patch('tariffs/:id')
  @RequirePermissions('tariff:manage')
  update(@Auth() ctx: AuthContext, @Param('id') id: string, @Body() dto: UpdateTariffDto) {
    return this.tariffs.update(ctx, id, dto);
  }

  @ApiOperation({
    summary: "List a child's assigned tariffs",
  })
  @Get('children/:childId/tariffs')
  @RequirePermissions('charge:read')
  tariffsOfChild(@Param('childId') childId: string) {
    return this.tariffs.tariffsOfChild(childId);
  }

  @ApiOperation({
    summary: 'Assign a tariff to a child',
  })
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
