import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { AppConfigService } from '../config/app-config.service';
import { TelegramClient } from './telegram-client.service';
import { TelegramUpdateHandlerService } from './telegram-update-handler.service';

/**
 * Long-polling transport (05-telegram-spec.md §6 — recommended for Stage
 * 1: no public HTTPS endpoint, works behind a dynamic IP). Only inbound
 * volume is `/start`/`/stop`/`/language`/`/help`, so a single loop with a
 * ~30s long-poll timeout is plenty; outbound sends go through the
 * separate pg-boss `notification.send` queue, never this loop.
 *
 * Also owns the polling/webhook transport switch at boot: Telegram only
 * ever delivers through one of the two, so whichever mode is *not*
 * configured needs its registration actively cleared, not just left
 * unused — a webhook registered by an earlier deploy silently starves
 * getUpdates() of every update if it's never torn down.
 */
@Injectable()
export class TelegramPollingService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(TelegramPollingService.name);
  private running = false;
  private offset = 0;
  private loopPromise?: Promise<void>;

  constructor(
    private readonly config: AppConfigService,
    private readonly client: TelegramClient,
    private readonly handler: TelegramUpdateHandlerService,
  ) {}

  // Not `async` / not awaited by Nest: setWebhook/deleteWebhook are
  // network calls to Telegram's API (bounded by a 10s timeout, but still
  // not something the whole app's boot should ever wait on).
  onApplicationBootstrap(): void {
    if (!this.config.get('TELEGRAM_ENABLED')) return;

    if (this.config.get('TELEGRAM_MODE') === 'webhook') {
      const url = `${this.config.get('APP_URL')}${this.config.get('API_PREFIX')}/telegram/webhook`;
      this.client
        .setWebhook(url, this.config.get('TELEGRAM_WEBHOOK_SECRET')!)
        .then(() => this.logger.log(`Telegram webhook registered at ${url}`))
        .catch((e: Error) => this.logger.error(`setWebhook failed: ${e.message}`));
      return;
    }

    this.client
      .deleteWebhook()
      .then(() => {
        this.running = true;
        this.loopPromise = this.loop();
        this.logger.log('Telegram long-polling started');
      })
      .catch((e: Error) => this.logger.error(`deleteWebhook failed: ${e.message}`));
  }

  async onModuleDestroy(): Promise<void> {
    this.running = false;
    await this.loopPromise;
  }

  private async loop(): Promise<void> {
    while (this.running) {
      try {
        const updates = await this.client.getUpdates(this.offset, 30);
        for (const update of updates) {
          this.offset = update.update_id + 1;
          try {
            await this.handler.handle(update);
          } catch (e) {
            this.logger.error(
              `Failed handling update ${update.update_id}: ${(e as Error).message}`,
            );
          }
        }
      } catch (e) {
        if (this.running) {
          this.logger.warn(`getUpdates failed, backing off 5s: ${(e as Error).message}`);
          await new Promise((r) => setTimeout(r, 5000));
        }
      }
    }
  }
}
