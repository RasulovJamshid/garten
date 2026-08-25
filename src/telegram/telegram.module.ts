import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { TelegramClient } from './telegram-client.service';
import { TelegramBindingService } from './telegram-binding.service';
import { TelegramUpdateHandlerService } from './telegram-update-handler.service';
import { TelegramPollingService } from './telegram-polling.service';
import { TelegramWebhookController } from './telegram-webhook.controller';
import { TelegramInviteController } from './telegram-invite.controller';

@Module({
  imports: [AuditModule],
  controllers: [TelegramWebhookController, TelegramInviteController],
  providers: [
    TelegramClient,
    TelegramBindingService,
    TelegramUpdateHandlerService,
    TelegramPollingService,
  ],
  exports: [TelegramClient, TelegramBindingService],
})
export class TelegramModule {}
