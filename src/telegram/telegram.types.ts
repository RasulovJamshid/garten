export interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id: number;
    text?: string;
    contact?: { phone_number: string; user_id?: number };
    chat: { id: number; type: string; username?: string };
    from?: { id: number; username?: string; language_code?: string };
  };
}

/** Minimal subset of Telegram's reply_markup we actually use — a one-shot request_contact button. */
export interface RequestContactKeyboard {
  keyboard: { text: string; request_contact: true }[][];
  one_time_keyboard: true;
  resize_keyboard: true;
}

export type TelegramSendResult =
  | { ok: true }
  | { ok: false; kind: 'rate_limited'; retryAfterSeconds: number }
  | { ok: false; kind: 'blocked' }
  | { ok: false; kind: 'chat_not_found' }
  | { ok: false; kind: 'other'; status: number; message: string };
