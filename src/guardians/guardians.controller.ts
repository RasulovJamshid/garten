import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
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

  @ApiOperation({
    summary: 'List guardians',
    description: 'Searchable by free-text query (q) or phone number. Requires guardian:read.',
  })
  @Get()
  list(@Query('q') q?: string, @Query('phone') phone?: string) {
    return this.guardians.list({ q, phone });
  }

  @ApiOperation({
    summary: 'Get a guardian by ID',
  })
  @Get(':id')
  get(@Param('id') id: string) {
    return this.guardians.findOneOrThrow(id);
  }

  @ApiOperation({
    summary: "List a guardian's children",
    description: 'Returns every child linked to this guardian, across all their links.',
  })
  @Get(':id/children')
  children(@Param('id') id: string) {
    return this.guardians.childrenOf(id);
  }

  @ApiOperation({
    summary: 'Create a guardian',
    description: 'Registers a new guardian record. Requires guardian:manage.',
  })
  @Post()
  @RequirePermissions('guardian:manage')
  create(@Auth() ctx: AuthContext, @Body() dto: CreateGuardianDto) {
    return this.guardians.create(ctx, dto);
  }

  @ApiOperation({
    summary: 'Update a guardian',
    description: "Updates a guardian's own profile fields. Requires guardian:manage.",
  })
  @Patch(':id')
  @RequirePermissions('guardian:manage')
  update(@Auth() ctx: AuthContext, @Param('id') id: string, @Body() dto: UpdateGuardianDto) {
    return this.guardians.update(ctx, id, dto);
  }
}
