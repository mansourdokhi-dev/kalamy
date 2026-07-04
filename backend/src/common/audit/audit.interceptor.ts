import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Observable, tap } from 'rxjs';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthenticatedUser } from '../auth/session.guard';

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

// Field names that must never be persisted verbatim into the audit log — these
// carry secrets (raw passwords, OTP codes, bearer tokens) that would otherwise
// sit in plaintext forever in the AuditLog.before/after JSON columns.
const SENSITIVE_FIELDS = new Set(['password', 'newPassword', 'passwordHash', 'token', 'code', 'devOtpCode']);
const REDACTED = '[REDACTED]';

/**
 * Replaces the value of any top-level sensitive field with a redacted marker.
 * All DTOs/response shapes audited today are flat, so a single-level walk is
 * sufficient — this intentionally does not recurse into nested objects/arrays.
 */
export function redactSensitiveFields<T>(value: T): T {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return value;
  }

  const result = { ...(value as Record<string, unknown>) };
  for (const key of Object.keys(result)) {
    if (SENSITIVE_FIELDS.has(key)) {
      result[key] = REDACTED;
    }
  }
  return result as T;
}

interface AuditableRequest {
  method: string;
  url: string;
  user?: AuthenticatedUser;
  body: unknown;
}

// "before" stores the request payload (what was asked for), "after" stores the
// resulting response body (what actually happened) — not a database pre/post diff.
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(private readonly prisma: PrismaService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<AuditableRequest>();

    if (!MUTATING_METHODS.has(request.method)) {
      return next.handle();
    }

    return next.handle().pipe(
      tap((responseBody) => {
        this.prisma.auditLog
          .create({
            data: {
              userId: request.user?.id,
              action: `${request.method} ${request.url}`,
              entity: request.url.split('/')[3] ?? 'unknown',
              entityId: this.extractEntityId(responseBody),
              before: this.toJson(request.body),
              after: this.toJson(responseBody),
            },
          })
          .catch(() => undefined);
      }),
    );
  }

  private extractEntityId(body: unknown): string | undefined {
    if (body && typeof body === 'object' && 'id' in body) {
      return String((body as { id: unknown }).id);
    }
    if (body && typeof body === 'object' && 'userId' in body) {
      return String((body as { userId: unknown }).userId);
    }
    return undefined;
  }

  private toJson(body: unknown): Prisma.InputJsonValue | undefined {
    if (!body) {
      return undefined;
    }
    const plain = JSON.parse(JSON.stringify(body)) as Prisma.InputJsonValue;
    return redactSensitiveFields(plain);
  }
}
