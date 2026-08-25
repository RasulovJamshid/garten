import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import * as Sentry from '@sentry/node';
import { Response } from 'express';
import { AuthenticatedRequest } from '../request-context';
import { AppException } from '../exceptions/app.exception';

const STATUS_FALLBACK_CODE: Record<number, string> = {
  400: 'VALIDATION_FAILED',
  401: 'UNAUTHENTICATED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  413: 'FILE_TOO_LARGE',
  415: 'UNSUPPORTED_MEDIA_TYPE',
  422: 'VALIDATION_FAILED',
  429: 'RATE_LIMITED',
};

/**
 * The single place every thrown error passes through on its way out.
 * Response shape is the contract from kindergarten-docs api-spec §2:
 * { error: { code, message, details, traceId } }. `message` is
 * English/debug only — clients localize from `code`.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<AuthenticatedRequest>();
    const traceId = req.traceId ?? 'unknown';

    if (exception instanceof AppException) {
      res.status(exception.getStatus()).json({
        error: {
          code: exception.code,
          message: exception.message,
          details: exception.details,
          traceId,
        },
      });
      return;
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      const asObject =
        typeof body === 'object' && body !== null ? (body as Record<string, any>) : {};

      // class-validator ValidationPipe shape: { message: string[] | string, ... }
      const isValidationShape = Array.isArray(asObject.message);
      const code = asObject.code ?? STATUS_FALLBACK_CODE[status] ?? 'INTERNAL_ERROR';
      const message = isValidationShape
        ? 'One or more fields are invalid'
        : (asObject.message ?? exception.message);
      const details = asObject.details ?? (isValidationShape ? asObject.message : undefined);

      // 4xx here is an expected client-error flow (validation, rate
      // limiting, ...), not a bug — only a >=500 wrapped in HttpException
      // is worth paging someone over.
      if (status >= 500) {
        Sentry.captureException(exception, { tags: { traceId } });
      }

      res.status(status).json({ error: { code, message, details, traceId } });
      return;
    }

    this.logger.error(
      `Unhandled exception [traceId=${traceId}]: ${(exception as Error)?.stack ?? exception}`,
    );
    Sentry.captureException(exception, { tags: { traceId } });
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'An unexpected error occurred',
        traceId,
      },
    });
  }
}
