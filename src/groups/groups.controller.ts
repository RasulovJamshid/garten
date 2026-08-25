import { Body, Controller, Get, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
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

  @Get()
  @RequirePermissions('group:read')
  list(
    @Auth() ctx: AuthContext,
    @Query('branchId') branchId?: string,
    @Query('status') status?: string,
  ) {
    return this.groups.list(ctx, { branchId, status });
  }

  @Post()
  @RequirePermissions('group:manage')
  create(@Auth() ctx: AuthContext, @Body() dto: CreateGroupDto) {
    return this.groups.create(ctx, dto);
  }

  @Get(':id')
  @RequirePermissions('group:read')
  get(@Auth() ctx: AuthContext, @Param('id') id: string) {
    return this.groups.findOneOrThrow(ctx, id);
  }

  @Patch(':id')
  @RequirePermissions('group:manage')
  update(@Auth() ctx: AuthContext, @Param('id') id: string, @Body() dto: UpdateGroupDto) {
    return this.groups.update(ctx, id, dto);
  }

  @Get(':id/children')
  @RequirePermissions('group:read')
  children(@Param('id') id: string) {
    return this.groups.childrenOf(id);
  }

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

  @Get(':id/staff')
  @RequirePermissions('group:read')
  staff(@Param('id') id: string) {
    return this.groups.staffOf(id);
  }

  @Put(':id/staff')
  @RequirePermissions('group:manage')
  setStaff(@Auth() ctx: AuthContext, @Param('id') id: string, @Body() dto: SetStaffDto) {
    return this.groups.setStaff(ctx, id, dto);
  }

  @Get(':id/history')
  @RequirePermissions('group:read')
  history(@Param('id') id: string) {
    return this.groups.history(id);
  }
}
