import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { ValidationError } from 'class-validator';

function fieldDetails(errors: ValidationError[], parent = ''): Record<string, string[]> {
  const details: Record<string, string[]> = {};
  for (const error of errors) {
    const path = parent ? parent + '.' + error.property : error.property;
    if (error.constraints) details[path] = Object.values(error.constraints);
    Object.assign(details, fieldDetails(error.children ?? [], path));
  }
  return details;
}

/** Keep HTTP and integration validation identical, including nested field paths. */
export function createValidationPipe(): ValidationPipe {
  return new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    transformOptions: { enableImplicitConversion: true },
    validationError: { target: false, value: false },
    exceptionFactory: (errors) =>
      new BadRequestException({
        code: 'VALIDATION_FAILED',
        message: 'One or more fields are invalid',
        details: fieldDetails(errors),
      }),
  });
}
