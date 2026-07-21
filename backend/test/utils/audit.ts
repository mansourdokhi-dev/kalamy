import type { Prisma, AuditLog } from '@prisma/client';
import { PrismaService } from '../../src/prisma/prisma.service';

/**
 * Polls the AuditLog table until at least `min` rows match `where`, or the
 * timeout elapses. PHI-read audit rows are written inside the request pipeline
 * but a fresh read-after-write can briefly miss them under heavy full-suite
 * load; polling makes the assertions deterministic without weakening them
 * (callers still assert the exact expected count on the returned rows).
 */
export async function waitForAuditLogs(
  prisma: PrismaService,
  where: Prisma.AuditLogWhereInput,
  { min = 1, timeoutMs = 3000, intervalMs = 50 }: { min?: number; timeoutMs?: number; intervalMs?: number } = {},
): Promise<AuditLog[]> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const logs = await prisma.auditLog.findMany({ where });
    if (logs.length >= min || Date.now() >= deadline) {
      return logs;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}
