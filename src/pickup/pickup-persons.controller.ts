import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
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

  @Get('children/:childId/pickup-persons')
  @RequirePermissions('pickup:read')
  list(@Param('childId') childId: string) {
    return this.pickup.personsOf(childId);
  }

  @Post('children/:childId/pickup-persons')
  @RequirePermissions('pickup:manage')
  create(
    @Auth() ctx: AuthContext,
    @Param('childId') childId: string,
    @Body() dto: CreatePickupPersonDto,
  ) {
    return this.pickup.createPerson(ctx, childId, dto);
  }

  @Patch('pickup-persons/:id')
  @RequirePermissions('pickup:manage')
  update(@Auth() ctx: AuthContext, @Param('id') id: string, @Body() dto: UpdatePickupPersonDto) {
    return this.pickup.updatePerson(ctx, id, dto);
  }

  @Delete('pickup-persons/:id')
  @RequirePermissions('pickup:manage')
  remove(@Auth() ctx: AuthContext, @Param('id') id: string) {
    return this.pickup.removePerson(ctx, id);
  }

  @Post('pickup-persons/:id/revoke')
  @RequirePermissions('pickup:manage')
  revoke(@Auth() ctx: AuthContext, @Param('id') id: string, @Body() dto: RevokePickupPersonDto) {
    return this.pickup.revokePerson(ctx, id, dto.reason);
  }
}
