import type { TenantTransaction } from "../tenant";

export async function findTenantById(trx: TenantTransaction, tenantId: string) {
  return trx
    .selectFrom("tenant")
    .select(["id", "slug", "name"])
    .where("id", "=", tenantId)
    .where("archived_at", "is", null)
    .executeTakeFirst();
}

export async function listActiveLocations(trx: TenantTransaction) {
  return trx
    .selectFrom("location")
    .select(["id", "name", "timezone", "address"])
    .where("archived_at", "is", null)
    .orderBy("name")
    .execute();
}

// Mirrors @boca/config REFERENCE_PHOTO_COUNT_* and the 0019 DB CHECK
// (packages/db deliberately does not depend on @boca/config — keep in sync).
export const REFERENCE_PHOTO_COUNT_DEFAULT = 3;
const REFERENCE_PHOTO_COUNT_MIN = 1;
const REFERENCE_PHOTO_COUNT_MAX = 5;

/**
 * How many PRIMARY reference photos (REF1..REFn) the AI compares a pass photo
 * against for this tenant. Absent tenant_settings row = the default (3).
 * RLS scopes the read to the transaction's tenant.
 */
export async function getReferencePhotoCount(trx: TenantTransaction): Promise<number> {
  const row = await trx
    .selectFrom("tenant_settings")
    .select(["reference_photo_count"])
    .executeTakeFirst();
  return row?.reference_photo_count ?? REFERENCE_PHOTO_COUNT_DEFAULT;
}

/** Admin-owned knob: upsert the tenant's reference photo count (1..5). */
export async function upsertReferencePhotoCount(
  trx: TenantTransaction,
  params: { tenantId: string; referencePhotoCount: number },
): Promise<void> {
  const count = params.referencePhotoCount;
  if (
    !Number.isInteger(count) ||
    count < REFERENCE_PHOTO_COUNT_MIN ||
    count > REFERENCE_PHOTO_COUNT_MAX
  ) {
    throw new Error(
      `upsertReferencePhotoCount: expected an integer ${REFERENCE_PHOTO_COUNT_MIN}..${REFERENCE_PHOTO_COUNT_MAX}, got ${count}`,
    );
  }
  await trx
    .insertInto("tenant_settings")
    .values({
      tenant_id: params.tenantId,
      reference_photo_count: count,
      updated_at: new Date(),
    })
    .onConflict((oc) =>
      oc.column("tenant_id").doUpdateSet({
        reference_photo_count: count,
        updated_at: new Date(),
      }),
    )
    .execute();
}
