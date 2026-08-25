import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { GuardiansService } from './guardians.service';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { Auth } from '../common/decorators/auth.decorator';
import { AuthContext } from '../common/auth-context';
import { LinkGuardianDto, UpdateGuardianLinkDto } from './dto/link-guardian.dto';

@ApiTags('children')
@Controller('children/:childId/guardians')
export class ChildGuardianLinksController {
  constructor(private readonly guardians: GuardiansService) {}

  @Get()
  @RequirePermissions('child:read')
  list(@Param('childId') childId: string) {
    return this.guardians.guardiansOfChild(childId);
  }

  @Post()
  @RequirePermissions('guardian:manage')
  link(@Auth() ctx: AuthContext, @Param('childId') childId: string, @Body() dto: LinkGuardianDto) {
    return this.guardians.link(ctx, childId, dto);
  }

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
