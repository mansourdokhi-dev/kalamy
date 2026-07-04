import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';
import { Response } from 'express';
import { ZodValidationException } from 'nestjs-zod';

interface ErrorBody {
  code: string;
  message: string;
  details?: unknown;
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    if (exception instanceof ZodValidationException) {
      const zodError = exception.getZodError() as { issues?: unknown };
      const body: ErrorBody = {
        code: 'VALIDATION_ERROR',
        message: 'Validation failed',
        details: zodError.issues,
      };
      response.status(HttpStatus.BAD_REQUEST).json(body);
      return;
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body: ErrorBody = {
        code: HttpStatus[status] ?? String(status),
        message: exception.message,
      };
      response.status(status).json(body);
      return;
    }

    const body: ErrorBody = { code: 'INTERNAL_ERROR', message: 'Unexpected error' };
    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json(body);
  }
}
