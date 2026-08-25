function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Global token bucket (~N/sec, Telegram's own ceiling) plus per-chat
 * spacing (~1/sec, also Telegram's) — 05-telegram-spec.md §4. In-memory
 * and per-process: correct for the single-node Stage 1 deployment this
 * whole spec assumes (§6 picks long polling for the same reason); a
 * multi-instance deployment would need this coordinated centrally.
 */
export class TelegramRateLimiter {
  private tokens: number;
  private lastRefill = Date.now();
  private readonly perChatLastSent = new Map<string, number>();

  constructor(private readonly ratePerSecond: number) {
    this.tokens = ratePerSecond;
  }

  private refill(): void {
    const now = Date.now();
    const elapsedSeconds = (now - this.lastRefill) / 1000;
    if (elapsedSeconds <= 0) return;
    this.tokens = Math.min(this.ratePerSecond, this.tokens + elapsedSeconds * this.ratePerSecond);
    this.lastRefill = now;
  }

  async acquire(chatId: string): Promise<void> {
    for (;;) {
      this.refill();
      if (this.tokens >= 1) {
        this.tokens -= 1;
        break;
      }
      await sleep(50);
    }

    const lastSentToChat = this.perChatLastSent.get(chatId) ?? 0;
    const sinceLastSend = Date.now() - lastSentToChat;
    if (sinceLastSend < 1000) {
      await sleep(1000 - sinceLastSend);
    }
    this.perChatLastSent.set(chatId, Date.now());
  }
}
