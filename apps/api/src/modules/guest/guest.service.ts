import type { GuestMenu, GuestMenuDish } from "@boca/contracts";
import { resolveTenantIdBySlug, withTenant } from "@boca/db";
import { Injectable } from "@nestjs/common";
import { parseBilingual } from "../admin/admin.helpers";
import { StorageService } from "../storage/storage.service";

// Fixture category the demo eval flow creates under a tenant — never shown to
// guests (same filter the admin catalog applies).
const HIDDEN_CATEGORY_RO = "Demo AI";

@Injectable()
export class GuestService {
  constructor(private readonly storage: StorageService) {}

  /**
   * Public menu for a tenant resolved from its URL slug. No principal: the slug
   * goes through the SECURITY DEFINER resolve_tenant_slug (the sanctioned
   * pre-tenant path), then reads run under that tenant's RLS context. Only
   * guest-safe fields are projected — no reference-set/station/cost internals.
   */
  async getMenu(tenantSlug: string): Promise<GuestMenu | null> {
    const tenantId = await resolveTenantIdBySlug(tenantSlug);
    if (!tenantId) {
      return null;
    }
    return withTenant(tenantId, async (trx) => {
      const tenant = await trx
        .selectFrom("tenant")
        .select(["name"])
        .where("id", "=", tenantId)
        .executeTakeFirst();

      const categories = await trx
        .selectFrom("menu_category")
        .select(["id", "name", "sort_order"])
        .where("tenant_id", "=", tenantId)
        .where("archived_at", "is", null)
        .orderBy("sort_order")
        .orderBy("created_at")
        .execute();

      const dishes = await trx
        .selectFrom("dish as d")
        .innerJoin("dish_version as v", (join) =>
          join.onRef("v.id", "=", "d.current_version_id").onRef("v.tenant_id", "=", "d.tenant_id"),
        )
        .select([
          "d.id as dish_id",
          "d.menu_category_id",
          "v.name",
          "v.description",
          "v.price_minor",
          "v.hero_photo_key",
          "v.allergen_codes",
        ])
        .where("d.tenant_id", "=", tenantId)
        .where("d.archived_at", "is", null)
        .orderBy("d.created_at")
        .execute();

      // Resolve signed URLs in parallel but KEEP query order (Promise.all
      // preserves array order), then bucket sequentially so dishes stay ordered.
      const withUrls = await Promise.all(
        dishes.map(async (row) => ({
          row,
          heroPhotoUrl: row.hero_photo_key
            ? await this.storage.getSignedUrl(row.hero_photo_key)
            : null,
        })),
      );
      const dishesByCategory = new Map<string, GuestMenuDish[]>();
      for (const { row, heroPhotoUrl } of withUrls) {
        const dish: GuestMenuDish = {
          id: row.dish_id,
          name: parseBilingual(row.name),
          description: row.description ? parseBilingual(row.description) : null,
          priceMinor: row.price_minor,
          heroPhotoUrl,
          allergenCodes: row.allergen_codes,
        };
        const bucket = dishesByCategory.get(row.menu_category_id);
        if (bucket) {
          bucket.push(dish);
        } else {
          dishesByCategory.set(row.menu_category_id, [dish]);
        }
      }

      return {
        tenant: { name: tenant?.name ?? tenantSlug },
        categories: categories
          .filter((cat) => parseBilingual(cat.name).ro !== HIDDEN_CATEGORY_RO)
          .map((cat) => ({
            id: cat.id,
            name: parseBilingual(cat.name),
            dishes: dishesByCategory.get(cat.id) ?? [],
          }))
          // Drop empty categories so the guest never sees a bare heading.
          .filter((cat) => cat.dishes.length > 0),
      };
    });
  }
}
