import { CreateAdjustmentDto } from './dto/adjustment.dto';
import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ChargesService } from './charges.service';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { Auth } from '../common/decorators/auth.decorator';
import { AuthContext } from '../common/auth-context';
import { CreateManualChargeDto, ReverseChargeDto } from './dto/manual-charge.dto';
import { RecalculateBillingService } from './recalculate-billing.service';
import { PreviewBillingRunDto } from './dto/preview-billing-run.dto';

@ApiTags('charges')
@Controller()
export class ChargesController {
  constructor(
    private readonly charges: ChargesService,
    private readonly recalculation: RecalculateBillingService,
  ) {}

  @Post('charges/adjustments')
  @RequirePermissions('charge:generate', 'charge:reverse')
  @ApiOperation({
    summary: 'Post a debit or credit adjustment to an open period; does not refund cash',
  })
  adjustment(@Auth() ctx: AuthContext, @Body() dto: CreateAdjustmentDto) {
    return this.charges.adjustment(ctx, dto);
  }

  @Get('children/:childId/charge-ledger')
  @RequirePermissions('charge:read')
  @ApiOperation({ summary: 'Full append-only charge history including credits and reversals' })
  ledger(@Param('childId') childId: string) {
    return this.charges.ledger(childId);
  }

  @Post('children/:childId/recalculate-billing')
  @RequirePermissions('charge:generate')
  recalculate(
    @Auth() ctx: AuthContext,
    @Param('childId') childId: string,
    @Body() dto: PreviewBillingRunDto,
  ) {
    return this.recalculation.resolve(ctx, childId, dto.year, dto.month);
  }

  @ApiOperation({
    summary: 'List charges',
    description: 'Filterable by child, period, kind, and unpaid-only.',
  })
  @Get('charges')
  @RequirePermissions('charge:read')
  list(
    @Query('childId') childId?: string,
    @Query('periodId') periodId?: string,
    @Query('kind') kind?: string,
    @Query('unpaidOnly') unpaidOnly?: string,
  ) {
    return this.charges.list({ childId, periodId, kind, unpaidOnly: unpaidOnly === 'true' });
  }

  @ApiOperation({
    summary: 'Create a manual charge',
    description:
      'Adds a one-off charge outside the normal billing-run flow (e.g. a fee or adjustment). ' +
      'Requires charge:generate.',
  })
  @Post('charges')
  @RequirePermissions('charge:generate')
  createManual(@Auth() ctx: AuthContext, @Body() dto: CreateManualChargeDto) {
    return this.charges.createManual(ctx, dto);
  }

  @ApiOperation({
    summary: 'Reverse a charge',
    description:
      'Reverses a charge rather than deleting it, preserving the append-only ledger (see ' +
      '06-ops-reference.md §3). Requires dto.reason and the separate charge:reverse permission.',
  })
  @Post('charges/:id/reverse')
  @RequirePermissions('charge:reverse')
  reverse(@Auth() ctx: AuthContext, @Param('id') id: string, @Body() dto: ReverseChargeDto) {
    return this.charges.reverse(ctx, id, dto.reason);
  }

  @ApiOperation({
    summary: "List a child's charges",
  })
  @Get('children/:childId/charges')
  @RequirePermissions('charge:read')
  forChild(@Param('childId') childId: string) {
    return this.charges.forChild(childId);
  }
}
