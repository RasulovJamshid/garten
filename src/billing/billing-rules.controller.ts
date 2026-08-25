import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { BillingRulesService } from './billing-rules.service';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { Auth } from '../common/decorators/auth.decorator';
import { AuthContext } from '../common/auth-context';
import { CreateBillingRulesDto, SimulateBillingDto } from './dto/create-billing-rules.dto';
import { BillingRules } from './billing-rules.types';

@ApiTags('billing-rules')
@Controller('billing-rules')
@RequirePermissions('billing_rules:manage')
export class BillingRulesController {
  constructor(private readonly billingRules: BillingRulesService) {}

  @Get()
  list() {
    return this.billingRules.list();
  }

  @Get('active')
  active(@Query('date') date?: string) {
    return this.billingRules.activeOn(date ? new Date(date) : new Date());
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.billingRules.get(id);
  }

  @Get(':id/diff')
  diff(@Param('id') id: string, @Query('against') against: string) {
    return this.billingRules.diff(id, against);
  }

  @Post()
  create(@Auth() ctx: AuthContext, @Body() dto: CreateBillingRulesDto) {
    return this.billingRules.create(
      ctx,
      dto.rules as unknown as BillingRules,
      dto.effectiveFrom,
      dto.note,
    );
  }

  @Post('simulate')
  simulate(@Body() dto: SimulateBillingDto) {
    return this.billingRules.simulateForChild(
      dto.childId,
      dto.year,
      dto.month,
      dto.rules as unknown as BillingRules | undefined,
    );
  }
}
