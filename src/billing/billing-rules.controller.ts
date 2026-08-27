import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
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

  @ApiOperation({
    summary: 'List billing rule versions',
    description: 'Every versioned billing-rules document ever published, per 03-billing-rules.md.',
  })
  @Get()
  list() {
    return this.billingRules.list();
  }

  @ApiOperation({
    summary: 'Get the active billing rules',
    description: 'The billing-rules version in effect on the given date (defaults to today).',
  })
  @Get('active')
  active(@Query('date') date?: string) {
    return this.billingRules.activeOn(date ? new Date(date) : new Date());
  }

  @ApiOperation({
    summary: 'Get a billing rules version by ID',
  })
  @Get(':id')
  get(@Param('id') id: string) {
    return this.billingRules.get(id);
  }

  @ApiOperation({
    summary: 'Diff two billing rules versions',
    description: 'Compares version :id against another version (?against=) to show what changed.',
  })
  @Get(':id/diff')
  diff(@Param('id') id: string, @Query('against') against: string) {
    return this.billingRules.diff(id, against);
  }

  @ApiOperation({
    summary: 'Publish a new billing rules version',
    description:
      'Creates a new versioned billing-rules document, effective from dto.effectiveFrom. Does ' +
      'not retroactively touch charges already generated under an earlier version.',
  })
  @Post()
  create(@Auth() ctx: AuthContext, @Body() dto: CreateBillingRulesDto) {
    return this.billingRules.create(
      ctx,
      dto.rules as unknown as BillingRules,
      dto.effectiveFrom,
      dto.note,
    );
  }

  @ApiOperation({
    summary: "Simulate a child's charge",
    description:
      'Dry-runs what a child would be charged for dto.year/dto.month, under either the ' +
      'currently active rules or a draft passed in dto.rules — without creating any real ' +
      'charge. Useful for previewing a rules change before publishing it.',
  })
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
