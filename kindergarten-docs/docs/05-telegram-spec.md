# Telegram Integration Specification

Primary notification channel. SMS is a fallback that requires a paid provider contract; Telegram is free, has near-universal penetration in Uzbekistan, and supports attachments — which SMS does not.

---

## 1. The problem this spec solves

A bot **cannot message a user who has not first messaged the bot.** There is no way to push a notification to a phone number. So the entire integration hinges on one thing: getting each guardian to press Start once, and reliably knowing which `chat_id` belongs to which guardian.

Everything below is about making that binding step reliable, because an unbound guardian silently receives nothing.

---

## 2. Binding flow — deep-link token (primary method)

```
1. Admin opens the guardian profile, clicks "Send Telegram invite"
2. Server generates a single-use token, stores it in telegram_link_token
   (expires in 72h), and returns a deep link:
       https://t.me/<bot_username>?start=<token>
3. Admin sends that link to the guardian (SMS, WhatsApp, printed QR, verbally)
4. Guardian taps it -> Telegram opens -> presses START
5. Telegram delivers to the bot:  { message: { text: "/start <token>", chat: { id } } }
6. Server validates the token, writes telegram_binding(guardian_id, chat_id),
   marks the token used, and replies with a confirmation in the guardian's language
```

**Why a token and not phone matching:** phone matching requires the guardian to share their contact, which many decline, and Telegram's phone field can differ from the one in your records. The token is unambiguous and auditable — you know exactly which admin invited whom and when.

### Token rules
- 32+ bytes of `crypto.randomBytes`, base64url. Never sequential, never guessable.
- Single use. `used_at` set inside the same transaction as the binding insert.
- 72-hour expiry. Expired token → bot replies "link expired, ask the kindergarten for a new one."
- Regenerating an invite invalidates any outstanding token for that guardian.

### Fallback: contact sharing
If the deep link is impractical, the bot can request a contact via a `request_contact` keyboard button. Match the returned `phone_number` against normalized `guardian.phone`. **Only accept an exact match on a phone that maps to exactly one guardian in the tenant** — ambiguous matches must be rejected and escalated to an admin, never guessed.

### QR code
Render the same deep link as a QR on printed enrollment paperwork. Same token mechanics.

---

## 3. Bot commands

| Command | Behaviour |
|---|---|
| `/start <token>` | Bind. Confirmation message with the child's name for verification. |
| `/start` (no token) | "Please use the link the kindergarten gave you." No enumeration of any kind. |
| `/stop` | Unbind — set `unbound_at`. Confirm that notifications will stop. |
| `/language` | Toggle uz/ru, writes `telegram_binding.language`. |
| `/help` | Static text plus the kindergarten's phone number. |

**Deliberately absent: `/balance`, `/attendance`, any data query.** A Telegram chat is not authenticated — anyone with access to the phone can read it, and `chat_id` is not proof of identity. Read access belongs in the Stage 2 parent portal behind a real login. The bot pushes notifications only.

---

## 4. Sending pipeline

```
event (check-in / payment / announcement)
  -> render template in recipient's language
  -> INSERT notification (status='queued', dedup_key)
  -> pg-boss job
  -> Telegram sendMessage
  -> update status
```

**Never send inside the request that triggered it.** A check-out API call must not wait on Telegram's API. Queue and return.

### Dedup
`dedup_key = sha256(template_key + recipient_id + entity_id)` with a unique index. A retried job, a double-clicked button, or a replayed offline check-in all collapse to one message. This is enforced in Postgres, not in application logic.

### Rate limits (Telegram's, not yours)
- ~30 messages/second globally per bot
- ~1 message/second to the same chat
- Bulk announcements to 300 guardians must be paced, or Telegram returns `429` with `retry_after`

Implementation: a token-bucket limiter in the worker at 25/sec, plus per-chat spacing. On `429`, respect `retry_after` exactly — do not use your own backoff, or the bot gets throttled harder.

### Retry policy
| Error | Action |
|---|---|
| `429 Too Many Requests` | Wait `retry_after`, retry. Does not count toward the attempt limit. |
| `403 Forbidden: bot was blocked by the user` | **Do not retry.** Set `blocked_bot = true`, status `failed`. Surface in the admin UI so someone re-invites them. |
| `400 chat not found` | Binding is stale. Mark unbound, status `failed`. |
| `5xx` / network | Exponential backoff, max 3 attempts. |

Max 3 attempts, then `failed` with `last_error` populated. Every failure is visible in the delivery log — a notification system whose failures are invisible is worse than none.

### Delivery semantics — be honest about this
Telegram's bot API confirms the message was **accepted by Telegram**, not that it was read. There are no read receipts for bots. So:

- `sent` = Telegram accepted it
- `delivered` = same thing; do not pretend otherwise
- `read_at` stays NULL for Telegram, always

Do not promise the client read confirmation. If they need proof a parent saw something (consent, emergency), that requires the Stage 2 portal with an explicit acknowledge button.

---

## 5. Templates

Stored per tenant in `notification_template`, both languages mandatory.

```
child_arrived   uz: "{child} bog'chaga keldi. Vaqt: {time}"
                ru: "{child} прибыл(а) в детский сад. Время: {time}"

child_departed  uz: "{child} bog'chadan ketdi. Kim olib ketdi: {pickup}. Vaqt: {time}"
                ru: "{child} покинул(а) детский сад. Забрал(а): {pickup}. Время: {time}"

payment_received uz: "To'lov qabul qilindi: {amount}. Kvitansiya: {receipt}"
                 ru: "Платёж принят: {amount}. Квитанция: {receipt}"

charge_created  uz: "{month} uchun hisob: {amount}. To'lov muddati: {due}"
                ru: "Начисление за {month}: {amount}. Срок оплаты: {due}"

debt_reminder   uz: "Qarzdorlik: {amount}. Iltimos, {due} gacha to'lang."
                ru: "Задолженность: {amount}. Просим оплатить до {due}."
```

- Language chosen per recipient: `telegram_binding.language` → `guardian.preferred_language` → `setting.default_language`.
- Variables validated against the template's `variables[]` array at save time — a typo'd `{amout}` must fail on save, not silently render as literal text to 300 parents.
- Use Telegram's `MarkdownV2` **or** plain text, and escape accordingly. Uzbek apostrophes (`o'`, `g'`) and Russian punctuation break unescaped MarkdownV2 constantly. **Recommendation: plain text.** The formatting is not worth the escaping bugs.

### Privacy defaults
`charge_created` and `debt_reminder` include amounts. Some clients consider that sensitive in a chat anyone can read over a shoulder. Make it a per-template toggle: `include_amounts: false` renders "You have a new charge, please check with the office."

**Never send medical information via Telegram.** Health incidents notify with "please contact the kindergarten," nothing more.

---

## 6. Transport: webhook vs polling

| | Webhook | Long polling |
|---|---|---|
| Needs public HTTPS | Yes | No |
| Latency | Lower | Fine (~1s) |
| Works behind NAT | No | Yes |
| Ops complexity | Higher | Lower |

**Recommendation: long polling for Stage 1.** The server already needs to reach out for sends; inbound volume is tiny (only `/start`). Polling removes a public-endpoint dependency and works if the kindergarten's server sits behind a dynamic IP. Switch to webhooks only if inbound volume grows in Stage 2.

If webhooks are used: set `secret_token` on `setWebhook` and verify the `X-Telegram-Bot-Api-Secret-Token` header on every request. Without it, anyone who learns the URL can forge bindings.

---

## 7. Configuration

```
TELEGRAM_BOT_TOKEN=...          # secret, env only, never in DB or git
TELEGRAM_BOT_USERNAME=...       # used to build deep links
TELEGRAM_MODE=polling           # polling | webhook
TELEGRAM_WEBHOOK_SECRET=...     # webhook mode only
TELEGRAM_RATE_LIMIT_PER_SEC=25
TELEGRAM_ENABLED=true           # kill switch — set false in dev/staging
```

**Staging must use a separate bot token.** A staging deployment pointed at the production bot will message real parents with test data. This has happened to everyone who did not separate them.

---

## 8. Coverage reality — plan for it

Not every guardian will bind. Expect 70–85% after a determined onboarding push. Therefore:

1. The admin UI must show a **"not bound to Telegram"** list, with a one-click re-invite.
2. Every notification has a channel fallback order: `telegram → sms → internal`. Internal means it sits in the system for the admin to relay by phone.
3. **Never treat "notification sent" as "parent informed"** for anything safety-critical. Emergency communication is a phone call; the system supports it, it does not replace it.
4. Track a bound-rate metric on the director dashboard. It is the single best predictor of whether the notification feature is actually working.

---

## 9. Tests

```
✓ valid token binds and marks token used, in one transaction
✓ same token used twice -> second attempt rejected
✓ expired token -> rejected with a helpful message
✓ /start with no token -> generic reply, no data disclosure
✓ /stop sets unbound_at; subsequent sends are skipped
✓ 403 blocked -> blocked_bot set, no retry, visible in admin list
✓ 429 -> honours retry_after, does not consume an attempt
✓ dedup_key collision -> exactly one row, one message
✓ uz and ru render correctly, including o' and g'
✓ template with an unknown variable fails validation on save
✓ TELEGRAM_ENABLED=false -> notifications queue but never send
✓ bulk send of 300 recipients stays under the rate limit and all complete
```

The `TELEGRAM_ENABLED=false` test matters most in CI — it is what stops your test suite from messaging real parents.
