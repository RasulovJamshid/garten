import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PickupService } from './pickup.service';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { Auth } from '../common/decorators/auth.decorator';
import { AuthContext } from '../common/auth-context';
import { TemporaryPermissionDto } from './dto/temporary-permission.dto';

@ApiTags('pickup')
@Controller()
export class PickupPermissionsController {
  constructor(private readonly pickup: PickupService) {}

  @Get('pickup-permissions/active')
  @RequirePermissions('pickup:read')
  active(@Query('childId') childId: string, @Query('date') date?: string) {
    return this.pickup.activePermissions(childId, date);
  }

  @Post('pickup-permissions/temporary')
  @RequirePermissions('pickup:temporary')
  createTemporary(@Auth() ctx: AuthContext, @Body() dto: TemporaryPermissionDto) {
    return this.pickup.createTemporary(ctx, dto);
  }

  @Get('children/:childId/pickup-history')
  @RequirePermissions('pickup:read')
  history(@Param('childId') childId: string) {
    return this.pickup.history(childId);
  }

  // Not @Public(): reception must be authenticated to call this, it's just
  // not gated behind a *tenant-scoped* record lookup the way other
  // endpoints are (verify() takes childId directly, no ScopeService check)
  // — deliberately, this is the one query reception hits at the door and
  // it must be fast and simple. Still requires pickup:read.
  @Get('pickup/verify')
  @RequirePermissions('pickup:read')
  verify(@Query('childId') childId: string, @Query('pickupPersonId') pickupPersonId: string) {
    return this.pickup.verify(childId, pickupPersonId);
  }
}
