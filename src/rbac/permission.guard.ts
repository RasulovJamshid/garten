import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthenticatedRequest } from '../common/request-context';
import { AuthContext } from '../common/auth-context';
import { AppErrors } from '../common/exceptions/app.exception';
import { PERMISSIONS_KEY } from '../common/decorators/permissions.decorator';
import { IS_PUBLIC_KEY } from '../common/decorators/public.decorator';
import { PermissionKey } from './permission-catalog';
import { PermissionResolverService } from './permission-resolver.service';
import { PermissionCacheService } from './permission-cache.service';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Runs after JwtAuthGuard (registration order matters — see AppModule).
 * Builds the request's AuthContext and enforces @RequirePermissions().
 *
 * Deliberately a plain singleton (see PermissionResolverService's comment)
 * — it reads req.user set by JwtAuthGuard rather than depending on any
 * request-scoped provider itself.
 */
@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly resolver: PermissionResolverService,
    private readonly cache: PermissionCacheService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    // Same bypass as JwtAuthGuard, checked first and unconditionally: a
    // @Public() route (login, health) never has req.user.
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (isPublic) return true;

    const req = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!req.user) throw AppErrors.unauthenticated();

    const required =
      this.reflector.getAllAndOverride<PermissionKey[]>(PERMISSIONS_KEY, [
        ctx.getHandler(),
        ctx.getClass(),
      ]) ?? [];

    const [branchIds, ownGroupIds] = await Promise.all([
      this.resolver.branchIds(req.user.sub),
      this.resolver.ownGroupIds(req.user.sub),
    ]);

    if (required.length === 0) {
      // No permission declared: JwtAuthGuard already enforced authentication.
      // Still attach a (cheap, uncached) context in case the handler reads it.
      const perms = await this.resolver.resolve(req.user.sub);
      req.authContext = new AuthContext(req.user.sub, req.user.tid, branchIds, ownGroupIds, perms);
      return true;
    }

    const tenant = await this.prisma.tenant.findUnique({
      where: { id: req.user.tid },
      select: { permissionsVersion: true },
    });
    const version = tenant?.permissionsVersion ?? 0;
    const cacheKey = `${req.user.sub}:${version}`;

    let perms = this.cache.get(cacheKey);
    if (!perms) {
      perms = await this.resolver.resolve(req.user.sub);
      this.cache.set(cacheKey, perms);
    }

    req.authContext = new AuthContext(req.user.sub, req.user.tid, branchIds, ownGroupIds, perms);

    const missing = required.filter((key) => !perms!.has(key));
    if (missing.length > 0) {
      throw AppErrors.forbidden(`Missing permission(s): ${missing.join(', ')}`);
    }

    return true;
  }
}
