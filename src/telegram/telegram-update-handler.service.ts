import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TelegramClient } from './telegram-client.service';
import { TelegramBindingService } from './telegram-binding.service';
import { RequestContactKeyboard, TelegramUpdate } from './telegram.types';

const SHARE_PHONE_KEYBOARD: RequestContactKeyboard = {
  keyboard: [[{ text: 'Share phone number / Telefon raqamni ulashish', request_contact: true }]],
  one_time_keyboard: true,
  resize_keyboard: true,
};

const HELP_TEXT: Record<'uz' | 'ru', string> = {
  uz: "Yordam kerakmi? Bog'cha bilan bog'laning: {phone}",
  ru: 'Нужна помощь? Свяжитесь с детским садом: {phone}',
};

/**
 * Bot command table from 05-telegram-spec.md §3. Shared by both transports
 * (long polling and webhook) — neither knows anything about commands
 * itself, they just hand every inbound Update here.
 *
 * Deliberately absent: /balance, /attendance, any data query — a Telegram
 * chat is not authenticated, chat_id is not proof of identity (§3). The
 * bot pushes notifications only.
 */
@Injectable()
export class TelegramUpdateHandlerService {
  private readonly logger = new Logger(TelegramUpdateHandlerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly client: TelegramClient,
    private readonly binding: TelegramBindingService,
  ) {}

  async handle(update: TelegramUpdate): Promise<void> {
    const message = update.message;
    if (!message) return;

    const chatId = BigInt(message.chat.id);

    if (message.contact) {
      await this.handleContact(chatId, message.contact.phone_number, message.chat.username);
      return;
    }

    if (!message.text) return;
    const text = message.text.trim();

    if (text === '/start' || text.startsWith('/start ')) {
      await this.handleStart(chatId, text.slice('/start'.length).trim(), message.chat.username);
    } else if (text === '/stop') {
      await this.handleStop(chatId);
    } else if (text === '/language') {
      await this.handleLanguage(chatId);
    } else if (text === '/help') {
      await this.handleHelp(chatId);
    }
    // Any other text: silently ignored — no data query surface (§3).
  }

  private async handleStart(chatId: bigint, token: string, username?: string): Promise<void> {
    if (!token) {
      // Fallback: contact sharing (§2) — offered when the guardian has no
      // deep-link token in hand, e.g. they just typed /start on their own.
      await this.client.sendMessage(
        chatId,
        'Please use the link the kindergarten gave you, or share your phone number below to link automatically.\n' +
          "Iltimos, bog'cha bergan havoladan foydalaning yoki pastdagi tugma orqali telefon raqamingizni ulashing.",
        SHARE_PHONE_KEYBOARD,
      );
      return;
    }

    const result = await this.binding.bindWithToken(token, chatId, username);
    switch (result.kind) {
      case 'bound': {
        const names = result.childNames.length > 0 ? result.childNames.join(', ') : null;
        await this.client.sendMessage(
          chatId,
          names
            ? `Bog'landi! Farzand(lar)ingiz: ${names}\nПодключено! Ваш(и) ребёнок/дети: ${names}`
            : "Bog'landi! / Подключено!",
        );
        return;
      }
      case 'used':
      case 'invalid':
        await this.client.sendMessage(
          chatId,
          'Link is no longer valid. / Havola endi amal qilmaydi.',
        );
        return;
      case 'expired':
        await this.client.sendMessage(
          chatId,
          "Link expired, ask the kindergarten for a new one. / Havola muddati tugagan, bog'chadan yangisini so'rang.",
        );
        return;
    }
  }

  private async handleContact(
    chatId: bigint,
    phoneNumber: string,
    username?: string,
  ): Promise<void> {
    const result = await this.binding.bindByPhone(phoneNumber, chatId, username);
    switch (result.kind) {
      case 'bound': {
        const names = result.childNames.length > 0 ? result.childNames.join(', ') : null;
        await this.client.sendMessage(
          chatId,
          names
            ? `Bog'landi! Farzand(lar)ingiz: ${names}\nПодключено! Ваш(и) ребёнок/дети: ${names}`
            : "Bog'landi! / Подключено!",
        );
        return;
      }
      case 'not_found':
        await this.client.sendMessage(
          chatId,
          'No matching record found — please contact the kindergarten.\n' +
            "Mos yozuv topilmadi — iltimos, bog'cha bilan bog'laning.",
        );
        return;
      case 'ambiguous':
        // §2: "must be rejected and escalated to an admin, never guessed" —
        // TelegramBindingService already logged this server-side.
        await this.client.sendMessage(
          chatId,
          'This phone number is not unique enough to link automatically — please contact the kindergarten directly.\n' +
            "Bu raqam avtomatik ulash uchun yetarlicha noyob emas — iltimos, bog'cha bilan bevosita bog'laning.",
        );
        return;
    }
  }

  private async handleStop(chatId: bigint): Promise<void> {
    const count = await this.binding.unbindByChatId(chatId);
    if (count > 0) {
      await this.client.sendMessage(
        chatId,
        "Bildirishnomalar to'xtatildi. / Уведомления остановлены.",
      );
    }
  }

  private async handleLanguage(chatId: bigint): Promise<void> {
    const bindings = await this.prisma.telegramBinding.findMany({
      where: { chatId, unboundAt: null },
    });
    if (bindings.length === 0) return;
    const next = bindings[0].language === 'uz' ? 'ru' : 'uz';
    await this.binding.setLanguageByChatId(chatId, next);
    await this.client.sendMessage(chatId, next === 'uz' ? "Til: o'zbekcha" : 'Язык: русский');
  }

  private async handleHelp(chatId: bigint): Promise<void> {
    const bindings = await this.prisma.telegramBinding.findMany({
      where: { chatId, unboundAt: null },
    });
    const tenantId = bindings[0]?.tenantId;
    const language = (bindings[0]?.language as 'uz' | 'ru' | undefined) ?? 'ru';
    const setting = tenantId
      ? await this.prisma.setting.findUnique({ where: { tenantId }, select: { phones: true } })
      : null;
    const phone = setting?.phones?.[0] ?? '—';
    await this.client.sendMessage(chatId, HELP_TEXT[language].replace('{phone}', phone));
  }
}
