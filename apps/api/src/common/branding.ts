import { brandColorsSchema, type TenantBranding } from "@boca/contracts";
import type { TenantTransaction } from "@boca/db";
import type { StorageService } from "../modules/storage/storage.service";

/** The neutral "no branding row" shape — apps render their own fallbacks. */
export function emptyBranding(): TenantBranding {
  return {
    displayName: null,
    tagline: null,
    greeting: null,
    promise: null,
    locations: [],
    logoMediaId: null,
    logoUrl: null,
    colors: {},
  };
}

/**
 * The tenant's brand identity in contract shape, with the logo presigned at
 * read time. Must run inside the tenant's RLS context. A malformed palette
 * (hand-edited jsonb) degrades to no overrides instead of failing the read.
 */
export async function loadBranding(
  trx: TenantTransaction,
  tenantId: string,
  storage: StorageService,
): Promise<TenantBranding> {
  const row = await trx
    .selectFrom("tenant_branding as b")
    .leftJoin("media_asset as m", (join) =>
      join.onRef("m.id", "=", "b.logo_media_id").onRef("m.tenant_id", "=", "b.tenant_id"),
    )
    .select([
      "b.display_name",
      "b.tagline",
      "b.greeting",
      "b.promise",
      "b.locations",
      "b.palette",
      "b.logo_media_id",
      "m.storage_key as logo_storage_key",
    ])
    .where("b.tenant_id", "=", tenantId)
    .executeTakeFirst();
  if (!row) {
    return emptyBranding();
  }
  const colors = brandColorsSchema.safeParse(row.palette);
  return {
    displayName: row.display_name,
    tagline: row.tagline,
    greeting: row.greeting,
    promise: row.promise,
    locations: row.locations ?? [],
    logoMediaId: row.logo_media_id,
    logoUrl: row.logo_storage_key ? await storage.getSignedUrl(row.logo_storage_key) : null,
    colors: colors.success ? colors.data : {},
  };
}
