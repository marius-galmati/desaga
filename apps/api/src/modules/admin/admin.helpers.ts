import { type BilingualText, bilingualTextSchema, type ToleranceVariance } from "@boca/contracts";
import type { TenantTransaction } from "@boca/db";

// Shared helpers for the tenant-admin backend: bilingual jsonb parsing, active
// capture-device resolution and the tolerance-variance vocabulary bridge.

/** Parse a jsonb {ro,en} column into a typed BilingualText. Seeded/admin data
 * is always well-formed; a malformed value is a data-integrity bug, so throw. */
export function parseBilingual(value: unknown): BilingualText {
  return bilingualTextSchema.parse(value);
}

/**
 * The location's ACTIVE capture device — reference photos must cite one so the
 * capture profile that produced them is reproducible. Prefers the most recently
 * created active device (the seed created "Pass Android — Desaga Cluj").
 */
export async function resolveActiveCaptureDevice(
  trx: TenantTransaction,
  tenantId: string,
  locationId: string,
): Promise<{ id: string; captureProfileVersion: string } | undefined> {
  const row = await trx
    .selectFrom("capture_device")
    .select(["id", "capture_profile_version"])
    .where("tenant_id", "=", tenantId)
    .where("location_id", "=", locationId)
    .where("is_active", "=", true)
    .orderBy("created_at", "desc")
    .executeTakeFirst();
  if (!row) {
    return undefined;
  }
  return { id: row.id, captureProfileVersion: row.capture_profile_version };
}

// Contract exposes strict|balanced|permissive; the DB jsonb + eval prompt
// (buildToleranceText) speak strict|normal|wide. Bridge both ways so the head
// chef's authoring vocabulary stays stable while the pipeline keeps working.
type DbVariance = "strict" | "normal" | "wide";

export function toDbVariance(variance: ToleranceVariance): DbVariance {
  switch (variance) {
    case "strict":
      return "strict";
    case "balanced":
      return "normal";
    case "permissive":
      return "wide";
  }
}

export function fromDbVariance(value: unknown): ToleranceVariance {
  switch (value) {
    case "strict":
      return "strict";
    case "wide":
      return "permissive";
    default:
      // "normal" and any legacy/unknown width map to the middle band.
      return "balanced";
  }
}
