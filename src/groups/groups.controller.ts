import { Body, Controller, Get, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { GroupsService } from './groups.service';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { Auth } from '../common/decorators/auth.decorator';
import { AuthContext } from '../common/auth-context';
import { CreateGroupDto } from './dto/create-group.dto';
import { UpdateGroupDto } from './dto/update-group.dto';
import { AssignChildDto } from './dto/assign-child.dto';
import { TransferChildDto } from './dto/transfer-child.dto';
import { SetStaffDto } from './dto/set-staff.dto';

@ApiTags('groups')
@Controller('groups')
export class GroupsController {
  constructor(private readonly groups: GroupsService) {}

  @ApiOperation({
    summary: 'List groups',
    description: 'Filterable by branchId and status. Requires group:read.',
  })
  @Get()
  @RequirePermissions('group:read')
  list(
    @Auth() ctx: AuthContext,
    @Query('branchId') branchId?: string,
    @Query('status') status?: string,
  ) {
    return this.groups.list(ctx, { branchId, status });
  }

  @ApiOperation({
    summary: 'Create a group',
    description: 'Requires group:manage.',
  })
  @Post()
  @RequirePermissions('group:manage')
  create(@Auth() ctx: AuthContext, @Body() dto: CreateGroupDto) {
    return this.groups.create(ctx, dto);
  }

  @ApiOperation({
    summary: 'Get a group by ID',
  })
  @Get(':id')
  @RequirePermissions('group:read')
  get(@Auth() ctx: AuthContext, @Param('id') id: string) {
    return this.groups.findOneOrThrow(ctx, id);
  }

  @ApiOperation({
    summary: 'Update a group',
    description: "Updates a group's own fields (name, capacity, etc). Requires group:manage.",
  })
  @Patch(':id')
  @RequirePermissions('group:manage')
  update(@Auth() ctx: AuthContext, @Param('id') id: string, @Body() dto: UpdateGroupDto) {
    return this.groups.update(ctx, id, dto);
  }

  @ApiOperation({
    summary: "List a group's children",
    description: 'Returns children currently assigned to this group. Requires group:read.',
  })
  @Get(':id/children')
  @RequirePermissions('group:read')
  children(@Param('id') id: string) {
    return this.groups.childrenOf(id);
  }

  @ApiOperation({
    summary: 'Assign a child to a group',
    description:
      "Closes out the child's current group assignment (if any) and opens a new one in this " +
      'group from dto.effectiveDate. Rejected with CAPACITY_EXCEEDED if the group is full unless ' +
      '?force=true — and force=true itself requires the group:capacity_override permission on ' +
      'top of group:manage.',
  })
  @Post(':id/children')
  @RequirePermissions('group:manage')
  assignChild(
    @Auth() ctx: AuthContext,
    @Param('id') id: string,
    @Body() dto: AssignChildDto,
    @Query('force') force?: string,
  ) {
    return this.groups.assignChild(ctx, id, dto, force === 'true');
  }

  @ApiOperation({
    summary: 'Transfer a child to another group',
    description:
      'Same capacity check and force/group:capacity_override rule as assign — the destination ' +
      'group is dto.toGroupId, not the :id in the URL (which is informational only).',
  })
  @Post(':id/transfer')
  @RequirePermissions('group:manage')
  transfer(
    @Auth() ctx: AuthContext,
    @Param('id') id: string,
    @Body() dto: TransferChildDto,
    @Query('force') force?: string,
  ) {
    return this.groups.transfer(ctx, id, dto, force === 'true');
  }

  @ApiOperation({
    summary: "List a group's staff",
  })
  @Get(':id/staff')
  @RequirePermissions('group:read')
  staff(@Param('id') id: string) {
    return this.groups.staffOf(id);
  }

  @ApiOperation({
    summary: "Set a group's staff",
    description: "Full replace (PUT) of the group's assigned staff list. Requires group:manage.",
  })
  @Put(':id/staff')
  @RequirePermissions('group:manage')
  setStaff(@Auth() ctx: AuthContext, @Param('id') id: string, @Body() dto: SetStaffDto) {
    return this.groups.setStaff(ctx, id, dto);
  }

  @ApiOperation({
    summary: "Get a group's assignment history",
    description: 'Every child assignment ever made to this group, most recent first.',
  })
  @Get(':id/history')
  @RequirePermissions('group:read')
  history(@Param('id') id: string) {
    return this.groups.history(id);
  }
}
