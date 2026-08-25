import { Controller, Get, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
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

  @Get('telegram/bindings')
  @RequirePermissions('guardian:manage')
  bindings(@Auth() ctx: AuthContext) {
    return this.binding.listBindings(ctx.tenantId);
  }

  // The "not bound to Telegram" admin list (§8.1) — the single best
  // predictor of whether the notification feature is actually working.
  @Get('telegram/unbound')
  @RequirePermissions('guardian:manage')
  unbound(@Auth() ctx: AuthContext) {
    return this.binding.listUnboundGuardians(ctx.tenantId);
  }
}
