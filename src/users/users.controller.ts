import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
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

  @Get()
  list(@Query('status') status?: string, @Query('branchId') branchId?: string) {
    return this.users.list({ status, branchId });
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.users.findOneOrThrow(id);
  }

  @Post()
  create(@Auth() ctx: AuthContext, @Body() dto: CreateUserDto) {
    return this.users.create(ctx, dto);
  }

  @Patch(':id')
  update(@Auth() ctx: AuthContext, @Param('id') id: string, @Body() dto: UpdateUserDto) {
    return this.users.update(ctx, id, dto);
  }

  @Post(':id/activate')
  activate(@Auth() ctx: AuthContext, @Param('id') id: string) {
    return this.users.setActive(ctx, id, true);
  }

  @Post(':id/deactivate')
  deactivate(@Auth() ctx: AuthContext, @Param('id') id: string) {
    return this.users.setActive(ctx, id, false);
  }

  @Get(':id/login-history')
  loginHistory(@Param('id') id: string) {
    return this.users.loginHistory(id);
  }

  @Get(':id/roles')
  roles(@Param('id') id: string) {
    return this.users.rolesOf(id);
  }

  @Post(':id/roles')
  assignRole(@Auth() ctx: AuthContext, @Param('id') id: string, @Body() dto: AssignRoleDto) {
    return this.users.assignRole(ctx, id, dto);
  }

  @Put(':id/roles')
  replaceRoles(@Auth() ctx: AuthContext, @Param('id') id: string, @Body() dto: ReplaceRolesDto) {
    return this.users.replaceRoles(ctx, id, dto.roles);
  }

  @Delete(':id/roles/:roleId')
  removeRole(
    @Auth() ctx: AuthContext,
    @Param('id') id: string,
    @Param('roleId') roleId: string,
    @Query('branchId') branchId?: string,
  ) {
    return this.users.removeRole(ctx, id, roleId, branchId);
  }

  @Get(':id/effective-permissions')
  effectivePermissions(@Param('id') id: string) {
    return this.users.effectivePermissions(id);
  }

  @Get(':id/permission-overrides')
  overrides(@Param('id') id: string) {
    return this.users.overridesOf(id);
  }

  @Post(':id/permission-overrides')
  setOverride(
    @Auth() ctx: AuthContext,
    @Param('id') id: string,
    @Body() dto: PermissionOverrideDto,
  ) {
    return this.users.setOverride(ctx, id, dto);
  }

  @Delete(':id/permission-overrides/:key')
  removeOverride(@Auth() ctx: AuthContext, @Param('id') id: string, @Param('key') key: string) {
    return this.users.removeOverride(ctx, id, key);
  }
}
