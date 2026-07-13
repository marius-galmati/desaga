import type { TenantTransaction } from "../tenant";

export interface BilingualText {
  ro: string;
  en: string;
}

export interface CreateDemoDishParams {
  tenantId: string;
  menuCategoryId: string;
  stationId: string;
  createdBy: string;
  name: BilingualText;
  description?: BilingualText;
  priceMinor: number;
  vatRateBp: number;
}

export interface CreatedDemoDish {
  dishId: string;
  dishVersionId: string;
  versionNo: number;
}

/**
 * dish + dish_version v1 in the caller's tx, then repoints
 * dish.current_version_id (the FK is circular, so three statements).
 * dish.refs_stale stays true until a reference set is activated.
 */
export async function createDemoDish(
  trx: TenantTransaction,
  params: CreateDemoDishParams,
): Promise<CreatedDemoDish> {
  const dish = await trx
    .insertInto("dish")
    .values({ tenant_id: params.tenantId, menu_category_id: params.menuCategoryId })
    .returning("id")
    .executeTakeFirstOrThrow();

  const version = await trx
    .insertInto("dish_version")
    .values({
      tenant_id: params.tenantId,
      dish_id: dish.id,
      version_no: 1,
      name: JSON.stringify(params.name),
      description: params.description ? JSON.stringify(params.description) : null,
      price_minor: params.priceMinor,
      vat_rate_bp: params.vatRateBp,
      station_id: params.stationId,
      created_by: params.createdBy,
    })
    .returning("id")
    .executeTakeFirstOrThrow();

  await trx
    .updateTable("dish")
    .set({ current_version_id: version.id })
    .where("id", "=", dish.id)
    .execute();

  return { dishId: dish.id, dishVersionId: version.id, versionNo: 1 };
}

/**
 * Admin listing: current version basics + whether an ACTIVE reference set /
 * tolerance profile exists (the partial unique indexes guarantee at most one
 * of each, so the left joins cannot multiply rows).
 */
export async function listDishesWithReferenceStatus(trx: TenantTransaction) {
  return trx
    .selectFrom("dish as d")
    .leftJoin("dish_version as v", (join) =>
      join.onRef("v.id", "=", "d.current_version_id").onRef("v.tenant_id", "=", "d.tenant_id"),
    )
    .leftJoin("reference_set as rs", (join) =>
      join
        .onRef("rs.dish_version_id", "=", "d.current_version_id")
        .onRef("rs.tenant_id", "=", "d.tenant_id")
        .on("rs.status", "=", "active"),
    )
    .leftJoin("tolerance_profile as tp", (join) =>
      join
        .onRef("tp.dish_id", "=", "d.id")
        .onRef("tp.tenant_id", "=", "d.tenant_id")
        .on("tp.status", "=", "active"),
    )
    .select([
      "d.id as dish_id",
      "d.refs_stale",
      "d.current_version_id",
      "v.version_no",
      "v.name",
      "v.price_minor",
      "v.vat_rate_bp",
      "v.non_scoreable",
      "rs.id as active_reference_set_id",
      "tp.id as active_tolerance_profile_id",
    ])
    .where("d.archived_at", "is", null)
    .orderBy("d.created_at")
    .execute();
}

/** Version row loaded when pinning a synthetic order item. */
export async function getDishVersionById(trx: TenantTransaction, dishVersionId: string) {
  return trx
    .selectFrom("dish_version")
    .select(["id", "dish_id", "name", "price_minor", "vat_rate_bp", "non_scoreable"])
    .where("id", "=", dishVersionId)
    .executeTakeFirst();
}
