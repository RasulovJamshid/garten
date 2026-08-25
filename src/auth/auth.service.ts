import { Injectable, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomBytes } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AppConfigService } from '../config/app-config.service';
import { PasswordService } from './password.service';
import { AppErrors } from '../common/exceptions/app.exception';
import { parseDurationMs } from '../common/duration';
import { TelegramClient } from '../telegram/telegram-client.service';
import { TelegramBindingService } from '../telegram/telegram-binding.service';

export interface RequestMeta {
  ipAddress?: string;
  userAgent?: string;
}

export interface TokenPair {
  accessToken: string;
  refreshCookie: string; // "<sessionId>.<rawToken>"
  refreshExpiresAt: Date;
}

function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

/**
 * Login happens before any tenant is known — this is the one module
 * allowed to hold a raw PrismaService (01-stage1-plan.md §2.4). Every
 * other module injects TenantPrisma.
 */
@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: AppConfigService,
    private readonly passwords: PasswordService,
    private readonly telegram: TelegramClient,
    private readonly telegramBinding: TelegramBindingService,
  ) {}

  async login(
    login: string,
    password: string,
    meta: RequestMeta,
  ): Promise<TokenPair & { user: unknown }> {
    const user = await this.prisma.appUser.findFirst({
      where: {
        deletedAt: null,
        OR: [{ phone: login }, { email: login }, { username: login }],
      },
    });

    const fail = async () => {
      await this.prisma.loginAttempt.create({
        data: {
          tenantId: user?.tenantId,
          login,
          success: false,
          ipAddress: meta.ipAddress,
          userAgent: meta.userAgent,
        },
      });
    };

    if (!user) {
      await fail();
      throw AppErrors.unauthenticated('Invalid login or password');
    }

    if (user.status !== 'active') {
      await fail();
      throw AppErrors.accountInactive();
    }

    if (user.lockedUntil && user.lockedUntil > new Date()) {
      await fail();
      throw AppErrors.accountLocked();
    }

    const valid = await this.passwords.verify(user.passwordHash, password);
    if (!valid) {
      await fail();
      const maxAttempts = this.config.get('LOGIN_MAX_ATTEMPTS');
      const failedAttempts = user.failedAttempts + 1;
      const lockedUntil =
        failedAttempts >= maxAttempts
          ? new Date(Date.now() + this.config.get('LOGIN_LOCKOUT_MINUTES') * 60_000)
          : null;
      await this.prisma.appUser.update({
        where: { id: user.id },
        data: { failedAttempts, lockedUntil },
      });
      throw AppErrors.unauthenticated('Invalid login or password');
    }

    await this.prisma.$transaction([
      this.prisma.appUser.update({
        where: { id: user.id },
        data: { failedAttempts: 0, lockedUntil: null, lastLoginAt: new Date() },
      }),
      this.prisma.loginAttempt.create({
        data: {
          tenantId: user.tenantId,
          login,
          success: true,
          ipAddress: meta.ipAddress,
          userAgent: meta.userAgent,
        },
      }),
    ]);

    const branchIds = (
      await this.prisma.userBranch.findMany({
        where: { userId: user.id },
        select: { branchId: true },
      })
    ).map((b) => b.branchId);

    const tokens = await this.issueTokens(user.id, user.tenantId, branchIds, meta);
    return { ...tokens, user: { id: user.id, fullName: user.fullName, tenantId: user.tenantId } };
  }

  async refresh(cookieValue: string | undefined, meta: RequestMeta): Promise<TokenPair> {
    const parsed = this.parseCookie(cookieValue);
    if (!parsed) throw AppErrors.unauthenticated('No refresh token');

    const session = await this.prisma.userSession.findUnique({ where: { id: parsed.sessionId } });
    if (!session || session.revokedAt || session.expiresAt < new Date()) {
      throw AppErrors.unauthenticated('Refresh token invalid or expired');
    }
    if (session.refreshTokenHash !== hashToken(parsed.rawToken)) {
      // Hash mismatch on a live session id is a strong signal of a stolen/replayed
      // token — revoke the whole session rather than silently rejecting once.
      await this.prisma.userSession.update({
        where: { id: session.id },
        data: { revokedAt: new Date() },
      });
      throw AppErrors.unauthenticated('Refresh token invalid or expired');
    }

    await this.prisma.userSession.update({
      where: { id: session.id },
      data: { revokedAt: new Date() },
    });

    // Deactivation must actually stop a session from renewing itself —
    // otherwise "blocks login" (api-spec §3) only blocks *new* logins while
    // an existing refresh cookie keeps the account alive forever.
    const user = await this.prisma.appUser.findUnique({
      where: { id: session.userId },
      select: { status: true, deletedAt: true },
    });
    if (!user || user.status !== 'active' || user.deletedAt) {
      throw AppErrors.accountInactive();
    }

    const branchIds = (
      await this.prisma.userBranch.findMany({
        where: { userId: session.userId },
        select: { branchId: true },
      })
    ).map((b) => b.branchId);

    return this.issueTokens(session.userId, session.tenantId, branchIds, meta);
  }

  async logout(cookieValue: string | undefined): Promise<void> {
    const parsed = this.parseCookie(cookieValue);
    if (!parsed) return;
    await this.prisma.userSession
      .update({ where: { id: parsed.sessionId }, data: { revokedAt: new Date() } })
      .catch(() => undefined); // already gone/invalid — logout is idempotent
  }

  private async issueTokens(
    userId: string,
    tenantId: string,
    branchIds: string[],
    meta: RequestMeta,
  ): Promise<TokenPair> {
    const accessToken = await this.jwt.signAsync(
      { sub: userId, tid: tenantId, bid: branchIds },
      { expiresIn: this.config.get('JWT_ACCESS_TTL') },
    );

    const rawToken = randomBytes(48).toString('base64url');
    const refreshTtlMs = parseDurationMs(this.config.get('JWT_REFRESH_TTL'));
    const expiresAt = new Date(Date.now() + refreshTtlMs);

    const session = await this.prisma.userSession.create({
      data: {
        tenantId,
        userId,
        refreshTokenHash: hashToken(rawToken),
        userAgent: meta.userAgent,
        ipAddress: meta.ipAddress,
        expiresAt,
      },
    });

    return { accessToken, refreshCookie: `${session.id}.${rawToken}`, refreshExpiresAt: expiresAt };
  }

  private parseCookie(
    value: string | undefined,
  ): { sessionId: string; rawToken: string } | undefined {
    if (!value) return undefined;
    const idx = value.indexOf('.');
    if (idx <= 0) return undefined;
    return { sessionId: value.slice(0, idx), rawToken: value.slice(idx + 1) };
  }

  /** Revokes every live session — a password change or reset must not leave old sessions valid elsewhere. */
  private async revokeAllSessions(userId: string): Promise<void> {
    await this.prisma.userSession.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<void> {
    const user = await this.prisma.appUser.findUnique({ where: { id: userId } });
    if (!user) throw AppErrors.notFound('User not found');

    const valid = await this.passwords.verify(user.passwordHash, currentPassword);
    if (!valid) throw AppErrors.unauthenticated('Current password is incorrect');

    const passwordHash = await this.passwords.hash(newPassword);
    await this.prisma.appUser.update({ where: { id: userId }, data: { passwordHash } });
    await this.revokeAllSessions(userId);
  }

  /**
   * No email/SMS provider exists in Stage 1 (SMS explicitly out of scope,
   * no email service configured) — Telegram is the only delivery channel
   * available, so this only works for a user who has bound their account.
   * Deliberately identical response whether the login matches a user,
   * has no Telegram binding, or Telegram is disabled — never confirms or
   * denies account existence (api-spec §2 error-handling posture, same
   * reasoning as /auth/login's generic "invalid login or password").
   */
  async forgotPassword(login: string): Promise<void> {
    const user = await this.prisma.appUser.findFirst({
      where: {
        deletedAt: null,
        status: 'active',
        OR: [{ phone: login }, { email: login }, { username: login }],
      },
    });
    if (!user) return;

    await this.prisma.passwordResetToken.updateMany({
      where: { userId: user.id, usedAt: null },
      data: { expiresAt: new Date() },
    });

    const token = randomBytes(32).toString('base64url');
    await this.prisma.passwordResetToken.create({
      data: {
        token,
        tenantId: user.tenantId,
        userId: user.id,
        expiresAt: new Date(Date.now() + 3600 * 1000), // 1h — shorter-lived than a Telegram invite; this is a live credential reset
      },
    });

    if (!this.telegram.enabled) return;
    const binding = await this.telegramBinding.findActiveBinding(user.tenantId, {
      userId: user.id,
    });
    if (!binding) {
      this.logger.warn(
        `forgotPassword: user ${user.id} has no Telegram binding, reset code not delivered`,
      );
      return;
    }

    await this.telegram.sendMessage(
      binding.chatId,
      `Password reset requested. Code (valid 1 hour): ${token}\n` +
        `If you did not request this, ignore this message.\n\n` +
        `Parol tiklash so'raldi. Kod (1 soat amal qiladi): ${token}\n` +
        `Agar buni so'ramagan bo'lsangiz, e'tiborsiz qoldiring.`,
    );
  }

  async resetPassword(token: string, newPassword: string): Promise<void> {
    const row = await this.prisma.passwordResetToken.findUnique({ where: { token } });
    if (!row || row.usedAt || row.expiresAt < new Date()) {
      throw AppErrors.validationFailed('Invalid or expired reset code');
    }

    const passwordHash = await this.passwords.hash(newPassword);
    await this.prisma.$transaction([
      this.prisma.passwordResetToken.update({ where: { token }, data: { usedAt: new Date() } }),
      this.prisma.appUser.update({
        where: { id: row.userId },
        data: { passwordHash, failedAttempts: 0, lockedUntil: null },
      }),
    ]);
    await this.revokeAllSessions(row.userId);
  }
}
