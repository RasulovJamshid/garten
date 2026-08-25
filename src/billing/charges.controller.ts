import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ChargesService } from './charges.service';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { Auth } from '../common/decorators/auth.decorator';
import { AuthContext } from '../common/auth-context';
import { CreateManualChargeDto, ReverseChargeDto } from './dto/manual-charge.dto';

@ApiTags('charges')
@Controller()
export class ChargesController {
  constructor(private readonly charges: ChargesService) {}

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

  @Post('charges')
  @RequirePermissions('charge:generate')
  createManual(@Auth() ctx: AuthContext, @Body() dto: CreateManualChargeDto) {
    return this.charges.createManual(ctx, dto);
  }

  @Post('charges/:id/reverse')
  @RequirePermissions('charge:reverse')
  reverse(@Auth() ctx: AuthContext, @Param('id') id: string, @Body() dto: ReverseChargeDto) {
    return this.charges.reverse(ctx, id, dto.reason);
  }

  @Get('children/:childId/charges')
  @RequirePermissions('charge:read')
  forChild(@Param('childId') childId: string) {
    return this.charges.forChild(childId);
  }
}
