import { Controller, Get, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { TelegramBindingService } from './telegram-binding.service';
import { TelegramClient } from './telegram-client.service';
import { AuditService } from '../audit/audit.service';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { Auth } from '../common/decorators/auth.decorator';
import { AuthContext } from '../common/auth-context';

@ApiTags('telegram')
@Controller()
export class TelegramInviteController {
  constructor(
    private readonly binding: TelegramBindingService,
    private readonly client: TelegramClient,
    private readonly audit: AuditService,
  ) {}

  @ApiOperation({
    summary: 'Create a Telegram invite for a guardian',
    description:
      'Generates a one-time deep link (expires in 72h) the guardian opens in Telegram to bind ' +
      'their account, so they can receive notifications (payment reminders, announcements, etc).',
  })
  @Post('guardians/:guardianId/telegram-invite')
  @RequirePermissions('guardian:manage')
  async invite(@Auth() ctx: AuthContext, @Param('guardianId') guardianId: string) {
    const token = await this.binding.createInviteToken(ctx.tenantId, guardianId, ctx.userId);
    await this.audit.log({
      userId: ctx.userId,
      action: 'guardian.telegram_invite',
      entityType: 'guardian',
      entityId: guardianId,
    });
    return { deepLink: this.client.buildDeepLink(token), expiresInHours: 72 };
  }

  @ApiOperation({
    summary: 'List Telegram bindings',
    description: 'Every guardian/staff Telegram account currently bound for this tenant.',
  })
  @Get('telegram/bindings')
  @RequirePermissions('guardian:manage')
  bindings(@Auth() ctx: AuthContext) {
    return this.binding.listBindings(ctx.tenantId);
  }

  // The "not bound to Telegram" admin list (§8.1) — the single best
  // predictor of whether the notification feature is actually working.
  @ApiOperation({
    summary: 'List guardians not yet bound to Telegram',
    description:
      'The single best predictor of whether the notification feature is actually working for ' +
      "this tenant (per 05-telegram-spec.md §8.1) — guardians here won't receive anything sent " +
      'over Telegram until they use an invite link.',
  })
  @Get('telegram/unbound')
  @RequirePermissions('guardian:manage')
  unbound(@Auth() ctx: AuthContext) {
    return this.binding.listUnboundGuardians(ctx.tenantId);
  }
}
