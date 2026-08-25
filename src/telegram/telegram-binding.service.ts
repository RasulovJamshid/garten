import { Injectable, Logger } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AppErrors } from '../common/exceptions/app.exception';
import { normalizePhone } from '../common/phone';

export type BindResult =
  | { kind: 'bound'; guardianId: string | null; childNames: string[] }
  | { kind: 'invalid' }
  | { kind: 'used' }
  | { kind: 'expired' };

export type PhoneBindResult =
  { kind: 'bound'; childNames: string[] } | { kind: 'not_found' } | { kind: 'ambiguous' };

/**
 * Everything here is cross-tenant by necessity: an inbound Telegram
 * update (`/start`, `/stop`, ...) arrives with only a `chat_id`, no JWT,
 * no resolved tenant — the token (or an existing binding row) *is* how
 * tenant gets resolved, exactly like JWT auth resolves it from the token
 * instead of request scope (see permission-resolver.service.ts for the
 * same reasoning). So this injects raw PrismaService, not TenantPrisma,
 * and every query carries its own explicit tenant_id filter by hand.
 */
@Injectable()
export class TelegramBindingService {
  private readonly logger = new Logger(TelegramBindingService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Regenerating an invite invalidates any outstanding token (§2 "Token rules"). */
  async createInviteToken(
    tenantId: string,
    guardianId: string,
    createdBy: string,
  ): Promise<string> {
    const guardian = await this.prisma.guardian.findFirst({
      where: { id: guardianId, tenantId, deletedAt: null },
    });
    if (!guardian) throw AppErrors.notFound('Guardian not found');

    await this.prisma.telegramLinkToken.updateMany({
      where: { guardianId, usedAt: null },
      data: { expiresAt: new Date() },
    });

    const token = randomBytes(32).toString('base64url');
    await this.prisma.telegramLinkToken.create({
      data: {
        token,
        tenantId,
        guardianId,
        expiresAt: new Date(Date.now() + 72 * 3600 * 1000),
        createdBy,
      },
    });
    return token;
  }

  /**
   * Validates + marks the token used + writes the binding, in one
   * transaction (§2, §9 "valid token binds and marks token used, in one
   * transaction"). Also drops any prior active binding on the same chat
   * or the same guardian first — both `uq_tg_chat` and `uq_tg_guardian`
   * are unique only while `unbound_at IS NULL`, so a stale row would
   * otherwise collide.
   */
  async bindWithToken(
    token: string,
    chatId: bigint,
    username: string | undefined,
  ): Promise<BindResult> {
    return this.prisma.$transaction(async (tx) => {
      const tokenRow = await tx.telegramLinkToken.findUnique({ where: { token } });
      if (!tokenRow) return { kind: 'invalid' };
      if (tokenRow.usedAt) return { kind: 'used' };
      if (tokenRow.expiresAt < new Date()) return { kind: 'expired' };

      await tx.telegramLinkToken.update({ where: { token }, data: { usedAt: new Date() } });

      await tx.telegramBinding.updateMany({
        where: { tenantId: tokenRow.tenantId, chatId, unboundAt: null },
        data: { unboundAt: new Date() },
      });
      if (tokenRow.guardianId) {
        await tx.telegramBinding.updateMany({
          where: { guardianId: tokenRow.guardianId, unboundAt: null },
          data: { unboundAt: new Date() },
        });
      }

      await tx.telegramBinding.create({
        data: {
          tenantId: tokenRow.tenantId,
          guardianId: tokenRow.guardianId,
          userId: tokenRow.userId,
          chatId,
          telegramUsername: username,
        },
      });

      let childNames: string[] = [];
      if (tokenRow.guardianId) {
        const links = await tx.childGuardian.findMany({
          where: { guardianId: tokenRow.guardianId },
          include: { child: { select: { firstName: true, lastName: true } } },
        });
        childNames = links.map((l) => `${l.child.firstName} ${l.child.lastName}`);
      }

      return { kind: 'bound', guardianId: tokenRow.guardianId, childNames };
    });
  }

  /**
   * Contact-sharing fallback (§2 "Fallback: contact sharing") — used when
   * the deep link is impractical. `guardian.phone` is only unique
   * *per tenant* (`@@unique([tenantId, phone])`), and this arrives with
   * no tenant context at all (no token, just a bare chat_id), so the
   * match has to be global: exactly one guardian across *every* tenant
   * with this phone. Two different kindergartens sharing this platform
   * both having a guardian on the same number is exactly the ambiguous
   * case the spec calls out — "must be rejected and escalated to an
   * admin, never guessed." There's no admin-escalation queue in Stage 1,
   * so "escalated" here means: logged server-side and the guardian is
   * told to contact the kindergarten directly, never silently bound to
   * either match.
   */
  async bindByPhone(
    rawPhone: string,
    chatId: bigint,
    username: string | undefined,
  ): Promise<PhoneBindResult> {
    const phone = normalizePhone(rawPhone);
    const matches = await this.prisma.guardian.findMany({
      where: { phone, deletedAt: null },
      select: { id: true, tenantId: true },
    });

    if (matches.length === 0) return { kind: 'not_found' };
    if (matches.length > 1) {
      this.logger.warn(
        `Ambiguous contact-share bind: phone matches ${matches.length} guardians across tenants ` +
          `[${matches.map((m) => m.tenantId).join(', ')}] — refusing to bind chat ${chatId}`,
      );
      return { kind: 'ambiguous' };
    }

    const guardian = matches[0];
    return this.prisma.$transaction(async (tx) => {
      await tx.telegramBinding.updateMany({
        where: { tenantId: guardian.tenantId, chatId, unboundAt: null },
        data: { unboundAt: new Date() },
      });
      await tx.telegramBinding.updateMany({
        where: { guardianId: guardian.id, unboundAt: null },
        data: { unboundAt: new Date() },
      });
      await tx.telegramBinding.create({
        data: {
          tenantId: guardian.tenantId,
          guardianId: guardian.id,
          chatId,
          telegramUsername: username,
        },
      });

      const links = await tx.childGuardian.findMany({
        where: { guardianId: guardian.id },
        include: { child: { select: { firstName: true, lastName: true } } },
      });
      return {
        kind: 'bound',
        childNames: links.map((l) => `${l.child.firstName} ${l.child.lastName}`),
      };
    });
  }

  async unbindByChatId(chatId: bigint): Promise<number> {
    const result = await this.prisma.telegramBinding.updateMany({
      where: { chatId, unboundAt: null },
      data: { unboundAt: new Date() },
    });
    return result.count;
  }

  async setLanguageByChatId(chatId: bigint, language: 'uz' | 'ru'): Promise<number> {
    const result = await this.prisma.telegramBinding.updateMany({
      where: { chatId, unboundAt: null },
      data: { language },
    });
    return result.count;
  }

  findActiveBinding(tenantId: string, recipient: { guardianId?: string; userId?: string }) {
    if (recipient.guardianId) {
      return this.prisma.telegramBinding.findFirst({
        where: { tenantId, guardianId: recipient.guardianId, unboundAt: null },
      });
    }
    if (recipient.userId) {
      return this.prisma.telegramBinding.findFirst({
        where: { tenantId, userId: recipient.userId, unboundAt: null },
      });
    }
    return Promise.resolve(null);
  }

  markBlocked(bindingId: string) {
    return this.prisma.telegramBinding.update({
      where: { id: bindingId },
      data: { blockedBot: true },
    });
  }

  markUnboundById(bindingId: string) {
    return this.prisma.telegramBinding.update({
      where: { id: bindingId },
      data: { unboundAt: new Date() },
    });
  }

  /** Admin "not bound to Telegram" list (§8.1) — the single best predictor of whether this feature works. */
  listUnboundGuardians(tenantId: string) {
    return this.prisma.guardian.findMany({
      where: { tenantId, deletedAt: null, telegramBinding: { none: { unboundAt: null } } },
      select: { id: true, fullName: true, phone: true },
      orderBy: { fullName: 'asc' },
    });
  }

  listBindings(tenantId: string) {
    return this.prisma.telegramBinding.findMany({
      where: { tenantId, unboundAt: null },
      include: { guardian: { select: { id: true, fullName: true, phone: true } } },
      orderBy: { boundAt: 'desc' },
    });
  }
}
