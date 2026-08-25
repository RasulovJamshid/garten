import { createParamDecorator, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { AuthenticatedRequest } from '../request-context';
import { AuthContext } from '../auth-context';

/** Injects the resolved AuthContext built by the PermissionGuard. */
export const Auth = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthContext => {
  const req = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
  if (!req.authContext) {
    throw new UnauthorizedException({
      code: 'UNAUTHENTICATED',
      message: 'No auth context on request',
    });
  }
  return req.authContext;
});
