import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ChargesService } from './charges.service';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { Auth } from '../common/decorators/auth.decorator';
import { AuthContext } from '../common/auth-context';
import { CreateManualChargeDto, ReverseChargeDto } from './dto/manual-charge.dto';

@ApiTags('charges')
@Controller()
export class ChargesController {
  constructor(private readonly charges: ChargesService) {}

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
