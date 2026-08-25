import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { RolesService } from './roles.service';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { Auth } from '../common/decorators/auth.decorator';
import { AuthContext } from '../common/auth-context';
import { CreateRoleDto } from './dto/create-role.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
import { ReplacePermissionsDto } from './dto/replace-permissions.dto';
import { CloneRoleDto } from './dto/clone-role.dto';
import { PermissionGrantDto } from './dto/permission-grant.dto';

@ApiTags('roles')
@Controller('roles')
@RequirePermissions('role:manage')
export class RolesController {
  constructor(private readonly roles: RolesService) {}

  @Get()
  list(@Query('includeSystem') includeSystem?: string) {
    return this.roles.list(includeSystem === 'true');
  }

  @Get('matrix')
  matrix() {
    return this.roles.matrix();
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.roles.get(id);
  }

  @Get(':id/users')
  users(@Param('id') id: string) {
    return this.roles.usersOf(id);
  }

  @Get(':id/diff')
  diff(@Param('id') id: string, @Query('against') against: string) {
    return this.roles.diff(id, against);
  }

  @Post()
  create(@Auth() ctx: AuthContext, @Body() dto: CreateRoleDto) {
    return this.roles.create(ctx, dto);
  }

  @Post(':id/clone')
  clone(@Auth() ctx: AuthContext, @Param('id') id: string, @Body() dto: CloneRoleDto) {
    return this.roles.clone(ctx, id, dto);
  }

  @Patch(':id')
  update(@Auth() ctx: AuthContext, @Param('id') id: string, @Body() dto: UpdateRoleDto) {
    return this.roles.update(ctx, id, dto);
  }

  @Delete(':id')
  remove(@Auth() ctx: AuthContext, @Param('id') id: string) {
    return this.roles.remove(ctx, id);
  }

  @Put(':id/permissions')
  replacePermissions(
    @Auth() ctx: AuthContext,
    @Param('id') id: string,
    @Body() dto: ReplacePermissionsDto,
  ) {
    return this.roles.replacePermissions(ctx, id, dto);
  }

  @Post(':id/permissions')
  grantOne(@Auth() ctx: AuthContext, @Param('id') id: string, @Body() dto: PermissionGrantDto) {
    return this.roles.grantOne(ctx, id, dto);
  }

  @Delete(':id/permissions/:key')
  revokeOne(@Auth() ctx: AuthContext, @Param('id') id: string, @Param('key') key: string) {
    return this.roles.revokeOne(ctx, id, key);
  }
}
