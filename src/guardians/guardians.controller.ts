import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { GuardiansService } from './guardians.service';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { Auth } from '../common/decorators/auth.decorator';
import { AuthContext } from '../common/auth-context';
import { CreateGuardianDto } from './dto/create-guardian.dto';
import { UpdateGuardianDto } from './dto/update-guardian.dto';

@ApiTags('guardians')
@Controller('guardians')
@RequirePermissions('guardian:read')
export class GuardiansController {
  constructor(private readonly guardians: GuardiansService) {}

  @Get()
  list(@Query('q') q?: string, @Query('phone') phone?: string) {
    return this.guardians.list({ q, phone });
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.guardians.findOneOrThrow(id);
  }

  @Get(':id/children')
  children(@Param('id') id: string) {
    return this.guardians.childrenOf(id);
  }

  @Post()
  @RequirePermissions('guardian:manage')
  create(@Auth() ctx: AuthContext, @Body() dto: CreateGuardianDto) {
    return this.guardians.create(ctx, dto);
  }

  @Patch(':id')
  @RequirePermissions('guardian:manage')
  update(@Auth() ctx: AuthContext, @Param('id') id: string, @Body() dto: UpdateGuardianDto) {
    return this.guardians.update(ctx, id, dto);
  }
}
