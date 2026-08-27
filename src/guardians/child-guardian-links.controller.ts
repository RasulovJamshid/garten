import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { GuardiansService } from './guardians.service';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { Auth } from '../common/decorators/auth.decorator';
import { AuthContext } from '../common/auth-context';
import { LinkGuardianDto, UpdateGuardianLinkDto } from './dto/link-guardian.dto';

@ApiTags('children')
@Controller('children/:childId/guardians')
export class ChildGuardianLinksController {
  constructor(private readonly guardians: GuardiansService) {}

  @ApiOperation({
    summary: "List a child's guardians",
    description:
      "Returns guardians linked to this child, with each link's relationship/access details. " +
      'Requires child:read.',
  })
  @Get()
  @RequirePermissions('child:read')
  list(@Param('childId') childId: string) {
    return this.guardians.guardiansOfChild(childId);
  }

  @ApiOperation({
    summary: 'Link a guardian to a child',
    description: 'Creates a new child–guardian relationship. Requires guardian:manage.',
  })
  @Post()
  @RequirePermissions('guardian:manage')
  link(@Auth() ctx: AuthContext, @Param('childId') childId: string, @Body() dto: LinkGuardianDto) {
    return this.guardians.link(ctx, childId, dto);
  }

  @ApiOperation({
    summary: 'Update a guardian link',
    description:
      "Edits an existing child–guardian link's relationship/access details (not the guardian's " +
      'own profile — see PATCH /guardians/:id for that). Requires guardian:manage.',
  })
  @Patch(':guardianId')
  @RequirePermissions('guardian:manage')
  update(
    @Auth() ctx: AuthContext,
    @Param('childId') childId: string,
    @Param('guardianId') guardianId: string,
    @Body() dto: UpdateGuardianLinkDto,
  ) {
    return this.guardians.updateLink(ctx, childId, guardianId, dto);
  }

  @ApiOperation({
    summary: 'Unlink a guardian from a child',
    description:
      'Removes the child–guardian relationship (the guardian record itself is untouched). ' +
      'Requires guardian:manage.',
  })
  @Delete(':guardianId')
  @RequirePermissions('guardian:manage')
  unlink(
    @Auth() ctx: AuthContext,
    @Param('childId') childId: string,
    @Param('guardianId') guardianId: string,
  ) {
    return this.guardians.unlink(ctx, childId, guardianId);
  }
}
