import { Injectable, NestMiddleware } from '@nestjs/common';
import { NextFunction, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { AuthenticatedRequest } from '../request-context';

/**
 * Every request gets a traceId, echoed on error responses and stamped onto
 * audit rows, so an incident can be correlated across logs without
 * guessing by timestamp under concurrency (ops-reference §1).
 */
@Injectable()
export class TraceIdMiddleware implements NestMiddleware {
  use(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
    const incoming = req.headers['x-trace-id'];
    req.traceId = (Array.isArray(incoming) ? incoming[0] : incoming) || randomUUID();
    res.setHeader('X-Trace-Id', req.traceId);
    next();
  }
}
