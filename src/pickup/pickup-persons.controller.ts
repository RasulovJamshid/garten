import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PickupService } from './pickup.service';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { Auth } from '../common/decorators/auth.decorator';
import { AuthContext } from '../common/auth-context';
import { CreatePickupPersonDto } from './dto/create-pickup-person.dto';
import { UpdatePickupPersonDto, RevokePickupPersonDto } from './dto/update-pickup-person.dto';

@ApiTags('pickup')
@Controller()
export class PickupPersonsController {
  constructor(private readonly pickup: PickupService) {}

  @ApiOperation({
    summary: "List a child's authorized pickup persons",
    description:
      'The standing list — not the same as who is currently active, see the pickup-permissions endpoints for that. Requires pickup:read.',
  })
  @Get('children/:childId/pickup-persons')
  @RequirePermissions('pickup:read')
  list(@Param('childId') childId: string) {
    return this.pickup.personsOf(childId);
  }

  @ApiOperation({
    summary: 'Add an authorized pickup person',
    description:
      "Adds someone to a child's standing pickup-authorization list. Requires pickup:manage.",
  })
  @Post('children/:childId/pickup-persons')
  @RequirePermissions('pickup:manage')
  create(
    @Auth() ctx: AuthContext,
    @Param('childId') childId: string,
    @Body() dto: CreatePickupPersonDto,
  ) {
    return this.pickup.createPerson(ctx, childId, dto);
  }

  @ApiOperation({
    summary: 'Update a pickup person',
  })
  @Patch('pickup-persons/:id')
  @RequirePermissions('pickup:manage')
  update(@Auth() ctx: AuthContext, @Param('id') id: string, @Body() dto: UpdatePickupPersonDto) {
    return this.pickup.updatePerson(ctx, id, dto);
  }

  @ApiOperation({
    summary: 'Remove a pickup person',
    description: 'Deletes the record outright. To keep a paper trail instead, use revoke below.',
  })
  @Delete('pickup-persons/:id')
  @RequirePermissions('pickup:manage')
  remove(@Auth() ctx: AuthContext, @Param('id') id: string) {
    return this.pickup.removePerson(ctx, id);
  }

  @ApiOperation({
    summary: 'Revoke a pickup person',
    description:
      'Revokes authorization without deleting the record, keeping dto.reason on file — the ' +
      'auditable alternative to DELETE.',
  })
  @Post('pickup-persons/:id/revoke')
  @RequirePermissions('pickup:manage')
  revoke(@Auth() ctx: AuthContext, @Param('id') id: string, @Body() dto: RevokePickupPersonDto) {
    return this.pickup.revokePerson(ctx, id, dto.reason);
  }
}
