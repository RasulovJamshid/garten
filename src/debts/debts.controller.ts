import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { DebtsService } from './debts.service';
import { RequirePermissions } from '../common/decorators/permissions.decorator';

@ApiTags('debts')
@Controller('debts')
@RequirePermissions('debt:read')
export class DebtsController {
  constructor(private readonly debts: DebtsService) {}

  @ApiOperation({
    summary: 'Get a debt summary',
    description: 'Aggregated outstanding-debt totals across the tenant.',
  })
  @Get('summary')
  summary() {
    return this.debts.summary();
  }

  @ApiOperation({
    summary: "Get a child's debt",
  })
  @Get(':childId')
  forChild(@Param('childId') childId: string) {
    return this.debts.forChild(childId);
  }

  @ApiOperation({
    summary: 'List debts',
    description:
      'Filterable by group, overdue-only, and a minimum amount — minAmountTiyin is in tiyin ' +
      '(1/100 of the display currency unit), matching how amounts are represented across this API.',
  })
  @Get()
  list(
    @Query('groupId') groupId?: string,
    @Query('overdueOnly') overdueOnly?: string,
    @Query('minAmountTiyin') minAmountTiyin?: string,
  ) {
    return this.debts.list({ groupId, overdueOnly: overdueOnly === 'true', minAmountTiyin });
  }
}
