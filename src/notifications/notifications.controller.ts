import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { NotificationsService } from './notifications.service';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { SendNotificationDto } from './dto/send-notification.dto';
import { AuthenticatedRequest } from '../common/request-context';

@ApiTags('notifications')
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @ApiOperation({
    summary: 'Send a notification',
    description:
      'Rate-limited to 20/min/tenant (not per-user, unlike most other endpoints). Requires an ' +
      'Idempotency-Key header for contract consistency with the other mutating endpoints — the ' +
      "real dedup guarantee comes from NotificationsService's own dedup_key, not this header.",
  })
  @Post('send')
  @RequirePermissions('notification:send')
  // api-spec §2: "Notification sends — 20/min/tenant" — a per-route
  // tracker override, since every other route limits per-user (§2's
  // "everything else" clause, handled globally by AppThrottlerGuard).
  @Throttle({
    default: {
      limit: 20,
      ttl: 60_000,
      getTracker: (req: Record<string, any>) =>
        (req as AuthenticatedRequest).user?.tid ?? req.ip ?? 'unknown',
    },
  })
  send(@Body() dto: SendNotificationDto, @Headers('idempotency-key') idempotencyKey?: string) {
    // See NotificationsService.insertDeduped: the dedup_key is what
    // actually makes retries safe, not this header — required here only
    // to keep the contract consistent with the other mutating financial
    // endpoints (api-spec §9).
    if (!idempotencyKey) {
      throw new BadRequestException({
        code: 'VALIDATION_FAILED',
        message: 'Idempotency-Key header is required',
      });
    }
    return this.notifications.send(dto);
  }

  @ApiOperation({
    summary: 'List notifications',
    description: 'Filterable by recipient, channel, status, and date range.',
  })
  @Get()
  @RequirePermissions('notification:read')
  list(
    @Query('recipientId') recipientId?: string,
    @Query('channel') channel?: string,
    @Query('status') status?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.notifications.list({ recipientId, channel, status, from, to });
  }

  @ApiOperation({
    summary: 'Get a notification by ID',
  })
  @Get(':id')
  @RequirePermissions('notification:read')
  get(@Param('id') id: string) {
    return this.notifications.get(id);
  }

  @ApiOperation({
    summary: 'Retry a failed notification',
  })
  @Post(':id/retry')
  @RequirePermissions('notification:send')
  retry(@Param('id') id: string) {
    return this.notifications.retry(id);
  }
}
