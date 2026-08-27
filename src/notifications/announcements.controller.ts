import { Body, Controller, Delete, Get, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AnnouncementsService } from './announcements.service';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { Auth } from '../common/decorators/auth.decorator';
import { AuthContext } from '../common/auth-context';
import { CreateAnnouncementDto } from './dto/announcement.dto';

@ApiTags('announcements')
@Controller('announcements')
export class AnnouncementsController {
  constructor(private readonly announcements: AnnouncementsService) {}

  @ApiOperation({
    summary: 'List announcements',
    description: 'Filterable by branch. Includes drafts — see status on each row.',
  })
  @Get()
  @RequirePermissions('announcement:manage')
  list(@Query('branchId') branchId?: string) {
    return this.announcements.list({ branchId });
  }

  @ApiOperation({
    summary: 'Create an announcement',
    description: 'Created as a draft — nothing is sent until POST /:id/publish.',
  })
  @Post()
  @RequirePermissions('announcement:manage')
  create(@Auth() ctx: AuthContext, @Body() dto: CreateAnnouncementDto) {
    return this.announcements.create(ctx, dto);
  }

  @ApiOperation({
    summary: 'Get an announcement by ID',
  })
  @Get(':id')
  @RequirePermissions('announcement:manage')
  get(@Param('id') id: string) {
    return this.announcements.get(id);
  }

  @ApiOperation({
    summary: 'Publish an announcement',
    description: 'Sends the announcement to its intended recipients via the notification pipeline.',
  })
  @Post(':id/publish')
  @RequirePermissions('announcement:manage')
  publish(@Auth() ctx: AuthContext, @Param('id') id: string) {
    return this.announcements.publish(ctx, id);
  }

  @ApiOperation({
    summary: 'Delete an announcement',
  })
  @Delete(':id')
  @RequirePermissions('announcement:manage')
  remove(@Auth() ctx: AuthContext, @Param('id') id: string) {
    return this.announcements.remove(ctx, id);
  }
}
