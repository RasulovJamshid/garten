import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
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

  @ApiOperation({
    summary: 'List roles',
    description: 'Set includeSystem=true to include built-in system roles alongside custom ones.',
  })
  @Get()
  list(@Query('includeSystem') includeSystem?: string) {
    return this.roles.list(includeSystem === 'true');
  }

  @ApiOperation({
    summary: 'Get the full role/permission matrix',
    description:
      'Every role crossed with every permission — the data behind a role-editor grid UI.',
  })
  @Get('matrix')
  matrix() {
    return this.roles.matrix();
  }

  @ApiOperation({
    summary: 'Get a role by ID',
  })
  @Get(':id')
  get(@Param('id') id: string) {
    return this.roles.get(id);
  }

  @ApiOperation({
    summary: "List a role's users",
    description: 'Every user currently assigned this role.',
  })
  @Get(':id/users')
  users(@Param('id') id: string) {
    return this.roles.usersOf(id);
  }

  @ApiOperation({
    summary: 'Diff two roles',
    description: "Compares role :id's permission grants against another role (?against=).",
  })
  @Get(':id/diff')
  diff(@Param('id') id: string, @Query('against') against: string) {
    return this.roles.diff(id, against);
  }

  @ApiOperation({
    summary: 'Create a role',
  })
  @Post()
  create(@Auth() ctx: AuthContext, @Body() dto: CreateRoleDto) {
    return this.roles.create(ctx, dto);
  }

  @ApiOperation({
    summary: 'Clone a role',
    description: 'Creates a new role with the same permission grants as an existing one.',
  })
  @Post(':id/clone')
  clone(@Auth() ctx: AuthContext, @Param('id') id: string, @Body() dto: CloneRoleDto) {
    return this.roles.clone(ctx, id, dto);
  }

  @ApiOperation({
    summary: 'Update a role',
    description: 'Cannot rename/modify the protected Owner role (01-stage1-plan.md §5.5).',
  })
  @Patch(':id')
  update(@Auth() ctx: AuthContext, @Param('id') id: string, @Body() dto: UpdateRoleDto) {
    return this.roles.update(ctx, id, dto);
  }

  @ApiOperation({
    summary: 'Delete a role',
    description:
      'Blocked for the protected Owner role and for any role still assigned to a user — the ' +
      '§5.5 safety rails (RbacSafetyService) exist specifically to prevent an accidental lockout.',
  })
  @Delete(':id')
  remove(@Auth() ctx: AuthContext, @Param('id') id: string) {
    return this.roles.remove(ctx, id);
  }

  @ApiOperation({
    summary: "Replace a role's permissions",
    description:
      "Full replace of the role's permission grants. Enforces the §5.5 safety rails: you cannot " +
      "grant a permission you don't hold yourself (privilege escalation), and a change that would " +
      'leave you locked out of managing roles is rejected (403 SELF_LOCKOUT) rather than applied.',
  })
  @Put(':id/permissions')
  replacePermissions(
    @Auth() ctx: AuthContext,
    @Param('id') id: string,
    @Body() dto: ReplacePermissionsDto,
  ) {
    return this.roles.replacePermissions(ctx, id, dto);
  }

  @ApiOperation({
    summary: 'Grant one permission to a role',
    description:
      'Same privilege-escalation and self-lockout rules as PUT /:id/permissions, for a single grant.',
  })
  @Post(':id/permissions')
  grantOne(@Auth() ctx: AuthContext, @Param('id') id: string, @Body() dto: PermissionGrantDto) {
    return this.roles.grantOne(ctx, id, dto);
  }

  @ApiOperation({
    summary: 'Revoke one permission from a role',
    description: 'Rejected with 403 SELF_LOCKOUT if it would leave you unable to manage roles.',
  })
  @Delete(':id/permissions/:key')
  revokeOne(@Auth() ctx: AuthContext, @Param('id') id: string, @Param('key') key: string) {
    return this.roles.revokeOne(ctx, id, key);
  }
}
