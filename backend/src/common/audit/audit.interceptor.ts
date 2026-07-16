import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Prisma } from '@prisma/client';
import { Observable, concatMap } from 'rxjs';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthenticatedUser } from '../auth/session.guard';
import { AUDIT_PHI_READ_KEY } from './audit-phi-read.decorator';

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
  params?: Record<string, string>;
}

// "before" stores the request payload (what was asked for), "after" stores the
// resulting response body (what actually happened) — not a database pre/post diff.
// PHI-read routes (see audit-phi-read.decorator.ts) get a lightweight entry
// instead: no before/after body (some are raw media streams, not JSON, and even
// the JSON ones could mean storing a patient's full clinical record a second
// time inside the audit log itself) — just who accessed which resource, when.
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reflector: Reflector,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<AuditableRequest>();
    const isPhiRead = this.reflector.getAllAndOverride<boolean>(AUDIT_PHI_READ_KEY, [context.getHandler(), context.getClass()]);

    if (!MUTATING_METHODS.has(request.method) && !isPhiRead) {
      return next.handle();
    }

    const entity = this.deriveEntity(context);

    return next.handle().pipe(
      concatMap(async (responseBody) => {
        await this.prisma.auditLog
          .create({
            data: isPhiRead
              ? {
                  userId: request.user?.id,
                  action: `${request.method} ${request.url}`,
                  entity,
                  entityId: this.extractReadEntityId(request),
                }
              : {
                  userId: request.user?.id,
                  action: `${request.method} ${request.url}`,
                  entity,
                  entityId: this.extractEntityId(responseBody),
                  before: this.toJson(request.body),
                  after: this.toJson(responseBody),
                },
          })
          .catch(() => undefined);
        return responseBody;
      }),
    );
  }

  private extractReadEntityId(request: AuditableRequest): string | undefined {
    return request.params?.patientId ?? request.params?.id;
  }

  /**
   * Derives the audited "entity" name from the controller handling the
   * request rather than the URL shape, so nested/renamed routes (e.g. a
   * future `/api/v1/patients/:id/assessments`) or a changed global prefix
   * don't silently break audit attribution.
   */
  private deriveEntity(context: ExecutionContext): string {
    const controllerName = context.getClass().name;
    return controllerName.replace(/Controller$/, '').toLowerCase() || 'unknown';
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
