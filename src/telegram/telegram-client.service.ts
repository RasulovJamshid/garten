import { Injectable, Logger } from '@nestjs/common';
import { AppConfigService } from '../config/app-config.service';
import { TelegramRateLimiter } from './telegram-rate-limiter';
import { RequestContactKeyboard, TelegramSendResult, TelegramUpdate } from './telegram.types';

/**
 * Thin wrapper over the Telegram Bot HTTP API — no DB access here, just
 * the wire protocol and the retry-policy classification table from
 * 05-telegram-spec.md §4. Everything that touches `telegram_binding` or
 * `notification` lives in TelegramBindingService / the notification
 * worker instead, which keeps this class trivially testable without a DB.
 */
@Injectable()
export class TelegramClient {
  private readonly logger = new Logger(TelegramClient.name);
  private readonly limiter: TelegramRateLimiter;

  constructor(private readonly config: AppConfigService) {
    this.limiter = new TelegramRateLimiter(this.config.get('TELEGRAM_RATE_LIMIT_PER_SEC'));
  }

  get enabled(): boolean {
    return this.config.get('TELEGRAM_ENABLED');
  }

  private baseUrl(): string {
    return `https://api.telegram.org/bot${this.config.get('TELEGRAM_BOT_TOKEN')}`;
  }

  buildDeepLink(token: string): string {
    return `https://t.me/${this.config.get('TELEGRAM_BOT_USERNAME')}?start=${token}`;
  }

  async sendMessage(
    chatId: string | bigint,
    text: string,
    replyMarkup?: RequestContactKeyboard,
  ): Promise<TelegramSendResult> {
    const chatIdStr = chatId.toString();
    await this.limiter.acquire(chatIdStr);

    let res: Response;
    try {
      res = await fetch(`${this.baseUrl()}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatIdStr,
          text,
          ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
        }),
      });
    } catch (e) {
      return { ok: false, kind: 'other', status: 0, message: (e as Error).message };
    }

    const body = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      description?: string;
      parameters?: { retry_after?: number };
    };

    if (res.ok && body.ok) return { ok: true };

    if (res.status === 429) {
      return {
        ok: false,
        kind: 'rate_limited',
        retryAfterSeconds: body.parameters?.retry_after ?? 5,
      };
    }
    if (res.status === 403) {
      return { ok: false, kind: 'blocked' };
    }
    if (res.status === 400 && /chat not found/i.test(body.description ?? '')) {
      return { ok: false, kind: 'chat_not_found' };
    }
    return {
      ok: false,
      kind: 'other',
      status: res.status,
      message: body.description ?? 'unknown error',
    };
  }

  /**
   * Registers (or clears) the webhook URL with Telegram itself — without
   * this, TelegramWebhookController just sits there as an endpoint
   * Telegram was never told to call. `secretToken` becomes the
   * X-Telegram-Bot-Api-Secret-Token every webhook delivery must present
   * (§6). Also used in reverse (empty url) when switching to polling —
   * webhook and polling are mutually exclusive at Telegram's end; a stale
   * webhook registration silently starves getUpdates of any results.
   */
  async setWebhook(url: string, secretToken: string): Promise<void> {
    const res = await fetch(`${this.baseUrl()}/setWebhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, secret_token: secretToken, allowed_updates: ['message'] }),
      signal: AbortSignal.timeout(10_000),
    });
    const body = (await res.json().catch(() => ({}))) as { ok?: boolean; description?: string };
    if (!body.ok) {
      this.logger.error(`setWebhook failed: ${body.description ?? res.status}`);
    }
  }

  async deleteWebhook(): Promise<void> {
    await fetch(`${this.baseUrl()}/deleteWebhook`, {
      method: 'POST',
      signal: AbortSignal.timeout(10_000),
    }).catch((e) => this.logger.warn(`deleteWebhook failed: ${(e as Error).message}`));
  }

  /** Long-poll transport (§6 — Stage 1 default; no public HTTPS endpoint needed). */
  async getUpdates(offset: number, timeoutSeconds: number): Promise<TelegramUpdate[]> {
    const url =
      `${this.baseUrl()}/getUpdates?offset=${offset}&timeout=${timeoutSeconds}` +
      `&allowed_updates=%5B%22message%22%5D`;
    const res = await fetch(url, { signal: AbortSignal.timeout((timeoutSeconds + 10) * 1000) });
    const body = (await res.json()) as {
      ok: boolean;
      result?: TelegramUpdate[];
      description?: string;
    };
    if (!body.ok) {
      throw new Error(`getUpdates failed: ${body.description ?? res.status}`);
    }
    return body.result ?? [];
  }
}
