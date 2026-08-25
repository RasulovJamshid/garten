import { Body, Controller, Delete, Get, Param, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AnnouncementsService } from './announcements.service';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { Auth } from '../common/decorators/auth.decorator';
import { AuthContext } from '../common/auth-context';
import { CreateAnnouncementDto } from './dto/announcement.dto';

@ApiTags('announcements')
@Controller('announcements')
export class AnnouncementsController {
  constructor(private readonly announcements: AnnouncementsService) {}

  @Get()
  @RequirePermissions('announcement:manage')
  list(@Query('branchId') branchId?: string) {
    return this.announcements.list({ branchId });
  }

  @Post()
  @RequirePermissions('announcement:manage')
  create(@Auth() ctx: AuthContext, @Body() dto: CreateAnnouncementDto) {
    return this.announcements.create(ctx, dto);
  }

  @Get(':id')
  @RequirePermissions('announcement:manage')
  get(@Param('id') id: string) {
    return this.announcements.get(id);
  }

  @Post(':id/publish')
  @RequirePermissions('announcement:manage')
  publish(@Auth() ctx: AuthContext, @Param('id') id: string) {
    return this.announcements.publish(ctx, id);
  }

  @Delete(':id')
  @RequirePermissions('announcement:manage')
  remove(@Auth() ctx: AuthContext, @Param('id') id: string) {
    return this.announcements.remove(ctx, id);
  }
}
