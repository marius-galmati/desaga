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
