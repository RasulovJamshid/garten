import { Body, Controller, Get, Param, Put, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { NotificationTemplatesService } from './notification-templates.service';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { Auth } from '../common/decorators/auth.decorator';
import { AuthContext } from '../common/auth-context';
import {
  PreviewNotificationTemplateDto,
  UpsertNotificationTemplateDto,
} from './dto/notification-template.dto';

@ApiTags('notification-templates')
@Controller('notification-templates')
export class NotificationTemplatesController {
  constructor(private readonly templates: NotificationTemplatesService) {}

  @ApiOperation({
    summary: 'List notification templates',
  })
  @Get()
  @RequirePermissions('notification_template:manage')
  list() {
    return this.templates.list();
  }

  @ApiOperation({
    summary: 'Create or update a template',
    description: 'Upsert by key (PUT, not POST) — the same key always refers to the same template.',
  })
  @Put(':key')
  @RequirePermissions('notification_template:manage')
  upsert(
    @Auth() ctx: AuthContext,
    @Param('key') key: string,
    @Body() dto: UpsertNotificationTemplateDto,
  ) {
    return this.templates.upsert(ctx, key, dto);
  }

  @ApiOperation({
    summary: 'Preview a template',
    description:
      'Renders the template with dto.sampleData substituted in, without sending anything.',
  })
  @Post(':key/preview')
  @RequirePermissions('notification_template:manage')
  preview(@Param('key') key: string, @Body() dto: PreviewNotificationTemplateDto) {
    return this.templates.preview(key, dto.sampleData);
  }
}
