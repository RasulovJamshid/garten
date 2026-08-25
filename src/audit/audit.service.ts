import { Injectable } from '@nestjs/common';
import { TenantPrisma } from '../prisma/tenant-prisma.provider';
import { computeDiff } from './audit-diff';

export interface AuditEntry {
  userId?: string;
  action: string; // e.g. 'payment.cancel' — see ops-reference §1 for the full list
  entityType: string;
  entityId?: string;
  /**
   * Pass only fields relevant to this action, already curated by the
   * caller — never a raw DB row. Secrets (password hashes, tokens) must
   * never appear here (ops-reference §1: "redact by allowlist, not
   * blocklist" — the allowlist IS "whatever the caller chose to pass").
   */
  oldValue?: Record<string, unknown>;
  newValue?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
  traceId?: string;
}

/**
 * Append-only by design: no update/delete method exists here, and the DB
 * trigger rejects UPDATE/DELETE on audit_log even if someone tries via
 * raw SQL (ops-reference §1).
 */
@Injectable()
export class AuditService {
  constructor(private readonly tenantPrisma: TenantPrisma) {}

  async log(entry: AuditEntry): Promise<void> {
    const diff = computeDiff(entry.oldValue, entry.newValue);
    await this.tenantPrisma.db.auditLog.create({
      data: {
        // Explicit even though the tenant extension would inject it too —
        // belt and suspenders beats a silent `any` cast (tenant-extension.ts).
        tenantId: this.tenantPrisma.tenantId,
        userId: entry.userId,
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId,
        oldValue: entry.oldValue as any,
        newValue: entry.newValue as any,
        diff: diff as any,
        ipAddress: entry.ipAddress,
        userAgent: entry.userAgent,
        traceId: entry.traceId,
      },
    });
  }
}
