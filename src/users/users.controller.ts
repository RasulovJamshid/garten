import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { UsersService } from './users.service';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { Auth } from '../common/decorators/auth.decorator';
import { AuthContext } from '../common/auth-context';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { AssignRoleDto } from './dto/assign-role.dto';
import { ReplaceRolesDto } from './dto/replace-roles.dto';
import { PermissionOverrideDto } from './dto/permission-override.dto';

@ApiTags('users')
@Controller('users')
@RequirePermissions('user:manage')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @ApiOperation({
    summary: 'List staff users',
    description: 'Filterable by status and branch.',
  })
  @Get()
  list(@Query('status') status?: string, @Query('branchId') branchId?: string) {
    return this.users.list({ status, branchId });
  }

  @ApiOperation({
    summary: 'Get a user by ID',
  })
  @Get(':id')
  get(@Param('id') id: string) {
    return this.users.findOneOrThrow(id);
  }

  @ApiOperation({
    summary: 'Create a staff user',
  })
  @Post()
  create(@Auth() ctx: AuthContext, @Body() dto: CreateUserDto) {
    return this.users.create(ctx, dto);
  }

  @ApiOperation({
    summary: 'Update a user',
  })
  @Patch(':id')
  update(@Auth() ctx: AuthContext, @Param('id') id: string, @Body() dto: UpdateUserDto) {
    return this.users.update(ctx, id, dto);
  }

  @ApiOperation({
    summary: 'Activate a user',
  })
  @Post(':id/activate')
  activate(@Auth() ctx: AuthContext, @Param('id') id: string) {
    return this.users.setActive(ctx, id, true);
  }

  @ApiOperation({
    summary: 'Deactivate a user',
    description:
      'Deactivating your own account, or the last active Owner, is rejected — see the §5.5 safety rails.',
  })
  @Post(':id/deactivate')
  deactivate(@Auth() ctx: AuthContext, @Param('id') id: string) {
    return this.users.setActive(ctx, id, false);
  }

  @ApiOperation({
    summary: "Get a user's login history",
  })
  @Get(':id/login-history')
  loginHistory(@Param('id') id: string) {
    return this.users.loginHistory(id);
  }

  @ApiOperation({
    summary: "List a user's roles",
  })
  @Get(':id/roles')
  roles(@Param('id') id: string) {
    return this.users.rolesOf(id);
  }

  @ApiOperation({
    summary: 'Assign a role to a user',
    description:
      'Enforces the §5.5 safety rails: you cannot assign a role that grants permissions you ' +
      "don't hold yourself (privilege escalation).",
  })
  @Post(':id/roles')
  assignRole(@Auth() ctx: AuthContext, @Param('id') id: string, @Body() dto: AssignRoleDto) {
    return this.users.assignRole(ctx, id, dto);
  }

  @ApiOperation({
    summary: "Replace a user's roles",
    description:
      'Full replace of dto.roles. Same privilege-escalation check as assign, plus a last-owner ' +
      "check — the tenant's final active Owner cannot have that role replaced away.",
  })
  @Put(':id/roles')
  replaceRoles(@Auth() ctx: AuthContext, @Param('id') id: string, @Body() dto: ReplaceRolesDto) {
    return this.users.replaceRoles(ctx, id, dto.roles);
  }

  @ApiOperation({
    summary: 'Remove a role from a user',
    description: 'Optionally scoped to one branchId. Same last-owner protection as PUT /:id/roles.',
  })
  @Delete(':id/roles/:roleId')
  removeRole(
    @Auth() ctx: AuthContext,
    @Param('id') id: string,
    @Param('roleId') roleId: string,
    @Query('branchId') branchId?: string,
  ) {
    return this.users.removeRole(ctx, id, roleId, branchId);
  }

  @ApiOperation({
    summary: "Get a user's effective permissions",
    description: 'The fully resolved permission set after combining roles and per-user overrides.',
  })
  @Get(':id/effective-permissions')
  effectivePermissions(@Param('id') id: string) {
    return this.users.effectivePermissions(id);
  }

  @ApiOperation({
    summary: "List a user's permission overrides",
    description: 'Per-user grants/revokes layered on top of their roles.',
  })
  @Get(':id/permission-overrides')
  overrides(@Param('id') id: string) {
    return this.users.overridesOf(id);
  }

  @ApiOperation({
    summary: 'Set a permission override for a user',
    description:
      'Grants or revokes a single permission for this user specifically, on top of whatever ' +
      'their roles already give them. Same privilege-escalation rule as role assignment applies.',
  })
  @Post(':id/permission-overrides')
  setOverride(
    @Auth() ctx: AuthContext,
    @Param('id') id: string,
    @Body() dto: PermissionOverrideDto,
  ) {
    return this.users.setOverride(ctx, id, dto);
  }

  @ApiOperation({
    summary: 'Remove a permission override',
  })
  @Delete(':id/permission-overrides/:key')
  removeOverride(@Auth() ctx: AuthContext, @Param('id') id: string, @Param('key') key: string) {
    return this.users.removeOverride(ctx, id, key);
  }
}
