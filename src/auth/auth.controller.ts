import { Body, Controller, Get, HttpCode, Post, Req, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiTags } from '@nestjs/swagger';
import { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { Public } from '../common/decorators/public.decorator';
import { Auth } from '../common/decorators/auth.decorator';
import { AuthContext } from '../common/auth-context';
import { AppConfigService } from '../config/app-config.service';
import { TenantPrisma } from '../prisma/tenant-prisma.provider';
import { parseDurationMs } from '../common/duration';

const REFRESH_COOKIE = 'kg_refresh';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly config: AppConfigService,
    private readonly tenantPrisma: TenantPrisma,
  ) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  // api-spec §2: "POST /auth/login — 5/min/IP" — no req.user exists yet
  // on this route, so AppThrottlerGuard's tracker already falls back to
  // IP; this just tightens the limit down from the 300/min default.
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async login(
    @Body() dto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.auth.login(dto.login, dto.password, {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
    this.setRefreshCookie(res, result.refreshCookie, result.refreshExpiresAt);
    return { accessToken: result.accessToken, user: result.user };
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const result = await this.auth.refresh(req.cookies?.[REFRESH_COOKIE], {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
    this.setRefreshCookie(res, result.refreshCookie, result.refreshExpiresAt);
    return { accessToken: result.accessToken };
  }

  @Public()
  @Post('logout')
  @HttpCode(200)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.auth.logout(req.cookies?.[REFRESH_COOKIE]);
    res.clearCookie(REFRESH_COOKIE, { path: `${this.config.get('API_PREFIX')}/auth` });
    return { success: true };
  }

  @Post('change-password')
  @HttpCode(200)
  async changePassword(@Auth() ctx: AuthContext, @Body() dto: ChangePasswordDto) {
    await this.auth.changePassword(ctx.userId, dto.currentPassword, dto.newPassword);
    return { success: true };
  }

  @Public()
  @Post('forgot-password')
  @HttpCode(200)
  // Same 5/min/IP ceiling as login — this also queries by login and could
  // otherwise be used to brute-force account enumeration or spam a bound
  // guardian/staff member's Telegram with reset codes.
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async forgotPassword(@Body() dto: ForgotPasswordDto) {
    await this.auth.forgotPassword(dto.login);
    return { success: true };
  }

  @Public()
  @Post('reset-password')
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async resetPassword(@Body() dto: ResetPasswordDto) {
    await this.auth.resetPassword(dto.token, dto.newPassword);
    return { success: true };
  }

  @Get('me')
  async me(@Auth() ctx: AuthContext) {
    const [user, userRoles, tenant] = await Promise.all([
      this.tenantPrisma.db.appUser.findUnique({
        where: { id: ctx.userId },
        select: {
          id: true,
          fullName: true,
          phone: true,
          email: true,
          username: true,
          language: true,
        },
      }),
      this.tenantPrisma.db.userRole.findMany({
        where: { userId: ctx.userId },
        include: { role: { select: { id: true, code: true, nameUz: true, nameRu: true } } },
      }),
      this.tenantPrisma.db.tenant.findUnique({
        where: { id: ctx.tenantId },
        select: { permissionsVersion: true },
      }),
    ]);

    return {
      user,
      branchIds: ctx.branchIds,
      roles: [...new Map(userRoles.map((ur) => [ur.role.id, ur.role])).values()],
      permissions: ctx.toJSON(),
      permissionsVersion: tenant?.permissionsVersion ?? 0,
    };
  }

  /**
   * The UI (apex domain) and this API (api.* subdomain) are different
   * *origins* but the same *site* — they share a registrable domain — so
   * `sameSite: 'lax'` is still sent on the UI's requests and stays the
   * stronger choice. Two things follow, before anyone "fixes" this:
   *
   * - The browser client must use `credentials: 'include'`; cross-origin
   *   fetch drops cookies by default. That, not this cookie, is the usual
   *   cause of an unexplained 401 from POST /auth/refresh.
   * - No `domain` attribute, deliberately. Host-only keeps the cookie on
   *   the API host; widening it to `.<domain>` would hand it to every
   *   future subdomain for nothing. If the UI ever moves to a *different*
   *   registrable domain this has to become `sameSite: 'none'` — strictly
   *   weaker, and a good reason not to move it.
   */
  private setRefreshCookie(res: Response, value: string, expiresAt: Date): void {
    res.cookie(REFRESH_COOKIE, value, {
      httpOnly: true,
      secure: this.config.isProduction,
      sameSite: 'lax',
      path: `${this.config.get('API_PREFIX')}/auth`,
      expires: expiresAt,
      maxAge: parseDurationMs(this.config.get('JWT_REFRESH_TTL')),
    });
  }
}
