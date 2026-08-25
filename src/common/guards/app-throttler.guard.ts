import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { AuthenticatedRequest } from '../request-context';

/**
 * api-spec §2 "Rate limits": "Everything else — 300/min/user." The
 * library's default tracker keys by IP alone, which would throttle an
 * entire office sharing one NAT'd IP as if it were a single user. Keyed
 * by the authenticated user id when present (JwtAuthGuard has already run
 * and set req.user by the time this guard fires — see the APP_GUARD
 * order in app.module.ts), falling back to IP only for unauthenticated
 * routes like POST /auth/login, where IP *is* the right key (§2: "5/min/IP").
 */
@Injectable()
export class AppThrottlerGuard extends ThrottlerGuard {
  protected async getTracker(req: AuthenticatedRequest): Promise<string> {
    return req.user?.sub ?? req.ip ?? 'unknown';
  }
}
