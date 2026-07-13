import type { AuditActorType } from "../generated/db";
import type { TenantTransaction } from "../tenant";

export interface AuditEntry {
  actorType: AuditActorType;
  actorId: string | null;
  action: string;
  subjectType?: string | null;
  subjectId?: string | null;
  subjectUserId?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  details?: unknown;
}

/**
 * Append-only write (RLS: INSERT policy only; UPDATE/DELETE are impossible).
 * Callers that audit reads of chef performance data must run this in the SAME
 * transaction as the read (arhitectura.md section 5.8).
 */
export async function insertAuditLog(
  trx: TenantTransaction,
  tenantId: string,
  entry: AuditEntry,
): Promise<void> {
  await trx
    .insertInto("audit_log")
    .values({
      tenant_id: tenantId,
      actor_type: entry.actorType,
      actor_id: entry.actorId,
      action: entry.action,
      subject_type: entry.subjectType ?? null,
      subject_id: entry.subjectId ?? null,
      subject_user_id: entry.subjectUserId ?? null,
      ip: entry.ip ?? null,
      user_agent: entry.userAgent ?? null,
      details: entry.details === undefined ? null : JSON.stringify(entry.details),
    })
    .execute();
}
