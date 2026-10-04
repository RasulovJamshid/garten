import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { map } from 'rxjs';
import { AppErrors } from '../exceptions/app.exception';

/** Backwards-compatible pagination for array collection responses. */
@Injectable()
export class ListPaginationInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler) {
    const request = context.switchToHttp().getRequest();
    const requested =
      request.method === 'GET' &&
      (request.query.page !== undefined || request.query.limit !== undefined);
    if (!requested) return next.handle();
    const page = Number(request.query.page ?? 1);
    const limit = Number(request.query.limit ?? 50);
    if (!Number.isInteger(page) || page < 1 || !Number.isInteger(limit) || limit < 1 || limit > 200)
      throw AppErrors.validationFailed('page must be positive and limit must be between 1 and 200');
    return next.handle().pipe(
      map((result) =>
        Array.isArray(result)
          ? {
              data: result.slice((page - 1) * limit, page * limit),
              meta: { page, limit, total: result.length, pages: Math.ceil(result.length / limit) },
            }
          : result,
      ),
    );
  }
}
