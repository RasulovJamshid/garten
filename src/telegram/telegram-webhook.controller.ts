import {
  BadRequestException,
  Controller,
  Headers,
  HttpCode,
  Logger,
  Post,
  Body,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { timingSafeEqual } from 'node:crypto';
import { Public } from '../common/decorators/public.decorator';
import { AppConfigService } from '../config/app-config.service';
import { TelegramUpdateHandlerService } from './telegram-update-handler.service';
import { TelegramUpdate } from './telegram.types';

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  // Length must match before timingSafeEqual (it throws on mismatched
  // lengths) — comparing against a fixed-length buffer first keeps the
  // whole check constant-time regardless of the caller's input length.
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/**
 * Only wired up when TELEGRAM_MODE=webhook. Requires `secret_token` to
 * have been set via `setWebhook`, verified against
 * X-Telegram-Bot-Api-Secret-Token — without it, anyone who learns the URL
 * can forge bindings (§6). Stage 1 default is polling
 * (TelegramPollingService); this exists for the alternative.
 */
@ApiTags('telegram')
@Controller('telegram')
export class TelegramWebhookController {
  private readonly logger = new Logger(TelegramWebhookController.name);

  constructor(
    private readonly config: AppConfigService,
    private readonly handler: TelegramUpdateHandlerService,
  ) {}

  @Post('webhook')
  @Public()
  @HttpCode(200)
  async webhook(
    @Body() update: TelegramUpdate,
    @Headers('x-telegram-bot-api-secret-token') secretToken?: string,
  ) {
    if (this.config.get('TELEGRAM_MODE') !== 'webhook' || !this.config.get('TELEGRAM_ENABLED')) {
      throw new BadRequestException('Webhook mode is not enabled');
    }
    const expected = this.config.get('TELEGRAM_WEBHOOK_SECRET');
    if (!expected || !secretToken || !safeEqual(secretToken, expected)) {
      throw new BadRequestException('Invalid secret token');
    }

    // Telegram retries a webhook delivery on anything but a 200 — an
    // unhandled processing error here must never turn into a retry storm
    // for what's usually a single bad update. Acknowledge receipt
    // unconditionally and log the failure server-side instead.
    try {
      await this.handler.handle(update);
    } catch (e) {
      this.logger.error(
        `Failed handling webhook update ${update.update_id}: ${(e as Error).message}`,
      );
    }
    return { ok: true };
  }
}
