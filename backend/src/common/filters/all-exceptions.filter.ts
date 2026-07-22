import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { Request, Response } from 'express';
import { ZodValidationException } from 'nestjs-zod';

interface ErrorBody {
  code: string;
  message: string;
  details?: unknown;
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

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

    // An unhandled exception reached the filter — this is a real server bug, not
    // a client error. Log it (with the route that triggered it) so it is never
    // silently swallowed behind the generic response the client receives.
    this.logger.error(
      `Unhandled exception on ${request?.method} ${request?.url}`,
      exception instanceof Error ? exception.stack : String(exception),
    );
    const body: ErrorBody = { code: 'INTERNAL_ERROR', message: 'Unexpected error' };
    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json(body);
  }
}
