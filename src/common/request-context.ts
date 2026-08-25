import { Request } from 'express';
import { AuthContext } from './auth-context';

/** Claims carried by the access token. `tid` never comes from anywhere else. */
export interface JwtPayload {
  sub: string; // userId
  tid: string; // tenantId
  bid: string[]; // branchIds the user has access to
}

export interface AuthenticatedRequest extends Request {
  user?: JwtPayload;
  authContext?: AuthContext;
  traceId?: string;
}
