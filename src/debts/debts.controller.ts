import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { DebtsService } from './debts.service';
import { RequirePermissions } from '../common/decorators/permissions.decorator';

@ApiTags('debts')
@Controller('debts')
@RequirePermissions('debt:read')
export class DebtsController {
  constructor(private readonly debts: DebtsService) {}

  @Get('summary')
  summary() {
    return this.debts.summary();
  }

  @Get(':childId')
  forChild(@Param('childId') childId: string) {
    return this.debts.forChild(childId);
  }

  @Get()
  list(
    @Query('groupId') groupId?: string,
    @Query('overdueOnly') overdueOnly?: string,
    @Query('minAmountTiyin') minAmountTiyin?: string,
  ) {
    return this.debts.list({ groupId, overdueOnly: overdueOnly === 'true', minAmountTiyin });
  }
}
