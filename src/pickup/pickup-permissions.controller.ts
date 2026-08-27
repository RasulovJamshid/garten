import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PickupService } from './pickup.service';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { Auth } from '../common/decorators/auth.decorator';
import { AuthContext } from '../common/auth-context';
import { TemporaryPermissionDto } from './dto/temporary-permission.dto';

@ApiTags('pickup')
@Controller()
export class PickupPermissionsController {
  constructor(private readonly pickup: PickupService) {}

  @ApiOperation({
    summary: 'List active pickup permissions',
    description:
      'Who is currently authorized to pick up a given child on the given date (defaults to ' +
      'today) — the standing list plus any temporary grants in effect.',
  })
  @Get('pickup-permissions/active')
  @RequirePermissions('pickup:read')
  active(@Query('childId') childId: string, @Query('date') date?: string) {
    return this.pickup.activePermissions(childId, date);
  }

  @ApiOperation({
    summary: 'Grant a temporary pickup permission',
    description:
      'One-off authorization for someone not on the standing pickup-persons list. Requires the ' +
      'separate pickup:temporary permission.',
  })
  @Post('pickup-permissions/temporary')
  @RequirePermissions('pickup:temporary')
  createTemporary(@Auth() ctx: AuthContext, @Body() dto: TemporaryPermissionDto) {
    return this.pickup.createTemporary(ctx, dto);
  }

  @ApiOperation({
    summary: "Get a child's pickup history",
    description: 'Every recorded pickup event for this child.',
  })
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
  @ApiOperation({
    summary: 'Verify a pickup person at the door',
    description:
      'The fast, single-purpose lookup reception uses at pickup time to confirm a given person ' +
      'is currently authorized for a given child. Requires pickup:read; see the code comment on ' +
      'this handler for why it skips the usual tenant-scoped record lookup other endpoints use.',
  })
  @Get('pickup/verify')
  @RequirePermissions('pickup:read')
  verify(@Query('childId') childId: string, @Query('pickupPersonId') pickupPersonId: string) {
    return this.pickup.verify(childId, pickupPersonId);
  }
}
