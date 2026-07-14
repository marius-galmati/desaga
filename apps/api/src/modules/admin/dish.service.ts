import type {
  AdminDishDetail,
  AdminDishListItem,
  CreateDishRequest,
  CreateReferenceSetRequest,
  DishAvailabilityEntry,
  ReferenceSetDetail,
  ToleranceCriteria,
  UpdateDishRequest,
} from "@boca/contracts";
import { createReferenceSet, type TenantTransaction, withTenant } from "@boca/db";
import { Injectable } from "@nestjs/common";
import type { Principal } from "../../common/principal";
import { resolveLocationId, type ServiceResult } from "../evaluation/evaluation.service";
import { StorageService } from "../storage/storage.service";
import {
  fromDbVariance,
  parseBilingual,
  resolveActiveCaptureDevice,
  toDbVariance,
} from "./admin.helpers";

// Default VAT when a create request omits it: Romanian restaurant food ~9%
// (matches seed-desaga VAT_FOOD_BP). The admin can override per dish.
const DEFAULT_VAT_RATE_BP = 900;

const TOLERANCE_KEYS = [
  "components",
  "arrangement",
  "sauce",
  "cleanliness",
  "color",
  "portion",
] as const;

@Injectable()
export class DishService {
  constructor(private readonly storage: StorageService) {}

  // --- Listing -------------------------------------------------------------
  async listDishes(principal: Principal, categoryId?: string): Promise<AdminDishListItem[]> {
    return withTenant(principal.tenantId, async (trx) => {
      let query = trx
        .selectFrom("dish as d")
        .innerJoin("dish_version as v", (join) =>
          join.onRef("v.id", "=", "d.current_version_id").onRef("v.tenant_id", "=", "d.tenant_id"),
        )
        .select([
          "d.id as dish_id",
          "d.menu_category_id",
          "d.refs_stale",
          "d.current_version_id",
          "v.version_no",
          "v.name",
          "v.price_minor",
          "v.hero_photo_key",
          "v.non_scoreable",
          "v.allergen_codes",
        ])
        .where("d.tenant_id", "=", principal.tenantId)
        .where("d.archived_at", "is", null)
        .orderBy("d.created_at");
      if (categoryId) {
        query = query.where("d.menu_category_id", "=", categoryId);
      }
      const dishes = await query.execute();
      if (dishes.length === 0) {
        return [];
      }

      const dishIds = dishes.map((d) => d.dish_id);
      const versionIds = dishes
        .map((d) => d.current_version_id)
        .filter((id): id is string => id !== null);
      const refSets = await this.activeReferenceSetsByVersion(trx, principal.tenantId, versionIds);
      const availability = await this.availabilityByDish(trx, principal.tenantId, dishIds);

      return Promise.all(
        dishes.map(async (d) => {
          const heroPhotoUrl = d.hero_photo_key
            ? await this.storage.getSignedUrl(d.hero_photo_key)
            : null;
          const refSet = d.current_version_id ? refSets.get(d.current_version_id) : undefined;
          return {
            id: d.dish_id,
            categoryId: d.menu_category_id,
            name: parseBilingual(d.name),
            priceMinor: d.price_minor,
            currentVersionNo: d.version_no,
            heroPhotoUrl,
            non_scoreable: d.non_scoreable,
            refsStale: d.refs_stale,
            referenceSet: refSet ?? null,
            availability: availability.get(d.dish_id) ?? [],
            allergenCodes: d.allergen_codes,
          };
        }),
      );
    });
  }

  async getDish(principal: Principal, id: string): Promise<ServiceResult<AdminDishDetail>> {
    return withTenant(principal.tenantId, async (trx) => {
      const detail = await this.loadDishDetail(trx, principal.tenantId, id);
      if (!detail) {
        return { ok: false as const, status: 404 as const, message: "dish not found" };
      }
      return { ok: true as const, value: detail };
    });
  }

  // --- Create / update -----------------------------------------------------
  async createDish(
    principal: Principal,
    body: CreateDishRequest,
  ): Promise<ServiceResult<AdminDishDetail>> {
    return withTenant(principal.tenantId, async (trx) => {
      const category = await trx
        .selectFrom("menu_category")
        .select(["id"])
        .where("tenant_id", "=", principal.tenantId)
        .where("id", "=", body.categoryId)
        .where("archived_at", "is", null)
        .executeTakeFirst();
      if (!category) {
        return { ok: false as const, status: 400 as const, message: "categoryId not found" };
      }
      const station = await trx
        .selectFrom("station")
        .select(["id"])
        .where("tenant_id", "=", principal.tenantId)
        .where("id", "=", body.stationId)
        .where("archived_at", "is", null)
        .executeTakeFirst();
      if (!station) {
        return { ok: false as const, status: 400 as const, message: "stationId not found" };
      }

      let heroPhotoKey: string | null = null;
      if (body.heroMediaId) {
        const key = await this.resolveMediaKey(trx, principal.tenantId, body.heroMediaId);
        if (!key) {
          return { ok: false as const, status: 400 as const, message: "heroMediaId not found" };
        }
        heroPhotoKey = key;
      }

      const dish = await trx
        .insertInto("dish")
        .values({ tenant_id: principal.tenantId, menu_category_id: body.categoryId })
        .returning("id")
        .executeTakeFirstOrThrow();

      const version = await trx
        .insertInto("dish_version")
        .values({
          tenant_id: principal.tenantId,
          dish_id: dish.id,
          version_no: 1,
          name: JSON.stringify(body.name),
          description: body.description ? JSON.stringify(body.description) : null,
          story: body.story ? JSON.stringify(body.story) : null,
          allergen_codes: body.allergenCodes ?? [],
          price_minor: body.priceMinor,
          vat_rate_bp: body.vatRateBp ?? DEFAULT_VAT_RATE_BP,
          hero_photo_key: heroPhotoKey,
          station_id: body.stationId,
          non_scoreable: body.non_scoreable ?? false,
          created_by: principal.userId,
        })
        .returning("id")
        .executeTakeFirstOrThrow();

      await trx
        .updateTable("dish")
        .set({ current_version_id: version.id })
        .where("tenant_id", "=", principal.tenantId)
        .where("id", "=", dish.id)
        .execute();

      const detail = await this.loadDishDetail(trx, principal.tenantId, dish.id);
      // loadDishDetail cannot be null here (row just created in this tx).
      return { ok: true as const, value: detail as AdminDishDetail };
    });
  }

  async updateDish(
    principal: Principal,
    id: string,
    body: UpdateDishRequest,
  ): Promise<ServiceResult<AdminDishDetail>> {
    return withTenant(principal.tenantId, async (trx) => {
      const dish = await trx
        .selectFrom("dish")
        .select(["id", "current_version_id"])
        .where("tenant_id", "=", principal.tenantId)
        .where("id", "=", id)
        .where("archived_at", "is", null)
        .executeTakeFirst();
      if (!dish || !dish.current_version_id) {
        return { ok: false as const, status: 404 as const, message: "dish not found" };
      }
      const current = await trx
        .selectFrom("dish_version")
        .selectAll()
        .where("tenant_id", "=", principal.tenantId)
        .where("id", "=", dish.current_version_id)
        .executeTakeFirstOrThrow();

      if (body.categoryId !== undefined) {
        const category = await trx
          .selectFrom("menu_category")
          .select(["id"])
          .where("tenant_id", "=", principal.tenantId)
          .where("id", "=", body.categoryId)
          .where("archived_at", "is", null)
          .executeTakeFirst();
        if (!category) {
          return { ok: false as const, status: 400 as const, message: "categoryId not found" };
        }
      }
      if (body.stationId !== undefined) {
        const station = await trx
          .selectFrom("station")
          .select(["id"])
          .where("tenant_id", "=", principal.tenantId)
          .where("id", "=", body.stationId)
          .where("archived_at", "is", null)
          .executeTakeFirst();
        if (!station) {
          return { ok: false as const, status: 400 as const, message: "stationId not found" };
        }
      }

      // hero_photo_key: undefined = keep, null = clear, mediaId = repoint.
      let heroPhotoKey: string | null = current.hero_photo_key;
      if (body.heroMediaId === null) {
        heroPhotoKey = null;
      } else if (body.heroMediaId !== undefined) {
        const key = await this.resolveMediaKey(trx, principal.tenantId, body.heroMediaId);
        if (!key) {
          return { ok: false as const, status: 400 as const, message: "heroMediaId not found" };
        }
        heroPhotoKey = key;
      }

      // description/story: undefined = keep, null = clear, value = set.
      const description =
        body.description === undefined
          ? current.description
          : body.description === null
            ? null
            : JSON.stringify(body.description);
      const story =
        body.story === undefined
          ? current.story
          : body.story === null
            ? null
            : JSON.stringify(body.story);

      const version = await trx
        .insertInto("dish_version")
        .values({
          tenant_id: principal.tenantId,
          dish_id: dish.id,
          version_no: current.version_no + 1,
          name: body.name === undefined ? JSON.stringify(current.name) : JSON.stringify(body.name),
          description,
          story,
          allergen_codes: body.allergenCodes ?? current.allergen_codes,
          price_minor: body.priceMinor ?? current.price_minor,
          vat_rate_bp: body.vatRateBp ?? current.vat_rate_bp,
          hero_photo_key: heroPhotoKey,
          station_id: body.stationId ?? current.station_id,
          non_scoreable: body.non_scoreable ?? current.non_scoreable,
          created_by: principal.userId,
        })
        .returning("id")
        .executeTakeFirstOrThrow();

      // Repoint current version; a new version has no active reference set yet,
      // so its references are stale until a new set is bound.
      await trx
        .updateTable("dish")
        .set({
          current_version_id: version.id,
          refs_stale: true,
          ...(body.categoryId === undefined ? {} : { menu_category_id: body.categoryId }),
        })
        .where("tenant_id", "=", principal.tenantId)
        .where("id", "=", dish.id)
        .execute();

      const detail = await this.loadDishDetail(trx, principal.tenantId, dish.id);
      return { ok: true as const, value: detail as AdminDishDetail };
    });
  }

  // --- Availability / archive ---------------------------------------------
  async setAvailability(
    principal: Principal,
    dishId: string,
    body: { locationId: string; is86ed: boolean },
  ): Promise<ServiceResult<DishAvailabilityEntry>> {
    return withTenant(principal.tenantId, async (trx) => {
      const dish = await trx
        .selectFrom("dish")
        .select(["id"])
        .where("tenant_id", "=", principal.tenantId)
        .where("id", "=", dishId)
        .where("archived_at", "is", null)
        .executeTakeFirst();
      if (!dish) {
        return { ok: false as const, status: 404 as const, message: "dish not found" };
      }
      const location = await trx
        .selectFrom("location")
        .select(["id"])
        .where("tenant_id", "=", principal.tenantId)
        .where("id", "=", body.locationId)
        .where("archived_at", "is", null)
        .executeTakeFirst();
      if (!location) {
        return { ok: false as const, status: 400 as const, message: "locationId not found" };
      }
      await trx
        .insertInto("dish_location_availability")
        .values({
          tenant_id: principal.tenantId,
          dish_id: dishId,
          location_id: body.locationId,
          is_86ed: body.is86ed,
          changed_by: principal.userId,
          changed_at: new Date(),
        })
        .onConflict((oc) =>
          oc.columns(["tenant_id", "dish_id", "location_id"]).doUpdateSet({
            is_86ed: body.is86ed,
            changed_by: principal.userId,
            changed_at: new Date(),
          }),
        )
        .execute();
      return {
        ok: true as const,
        value: { locationId: body.locationId, is86ed: body.is86ed },
      };
    });
  }

  async archiveDish(principal: Principal, id: string): Promise<ServiceResult<{ ok: true }>> {
    return withTenant(principal.tenantId, async (trx) => {
      const updated = await trx
        .updateTable("dish")
        .set({ archived_at: new Date() })
        .where("tenant_id", "=", principal.tenantId)
        .where("id", "=", id)
        .where("archived_at", "is", null)
        .executeTakeFirst();
      if (updated.numUpdatedRows === 0n) {
        return { ok: false as const, status: 404 as const, message: "dish not found" };
      }
      return { ok: true as const, value: { ok: true as const } };
    });
  }

  // --- Reference sets ------------------------------------------------------
  async getReferenceSet(
    principal: Principal,
    dishId: string,
  ): Promise<ServiceResult<ReferenceSetDetail | null>> {
    return withTenant(principal.tenantId, async (trx) => {
      const dish = await trx
        .selectFrom("dish")
        .select(["id", "current_version_id"])
        .where("tenant_id", "=", principal.tenantId)
        .where("id", "=", dishId)
        .where("archived_at", "is", null)
        .executeTakeFirst();
      if (!dish || !dish.current_version_id) {
        return { ok: false as const, status: 404 as const, message: "dish not found" };
      }
      const detail = await this.loadReferenceSetDetail(
        trx,
        principal.tenantId,
        dish.id,
        dish.current_version_id,
      );
      return { ok: true as const, value: detail };
    });
  }

  async createReferenceSet(
    principal: Principal,
    dishId: string,
    body: CreateReferenceSetRequest,
  ): Promise<ServiceResult<ReferenceSetDetail>> {
    const primaryCount = body.photos.filter((p) => p.role === "primary").length;
    if (primaryCount < 3) {
      return {
        ok: false,
        status: 400,
        message: `at least 3 primary photos required, got ${primaryCount}`,
      };
    }
    return withTenant(principal.tenantId, async (trx) => {
      const dish = await trx
        .selectFrom("dish")
        .select(["id", "current_version_id"])
        .where("tenant_id", "=", principal.tenantId)
        .where("id", "=", dishId)
        .where("archived_at", "is", null)
        .executeTakeFirst();
      if (!dish || !dish.current_version_id) {
        return { ok: false as const, status: 404 as const, message: "dish not found" };
      }

      // Resolve every mediaId to its storage key (tenant_id predicate + RLS).
      const storageKeys: string[] = [];
      for (const photo of body.photos) {
        const key = await this.resolveMediaKey(trx, principal.tenantId, photo.mediaId);
        if (!key) {
          return {
            ok: false as const,
            status: 400 as const,
            message: `mediaId ${photo.mediaId} not found`,
          };
        }
        storageKeys.push(key);
      }

      const locationId = await resolveLocationId(trx, principal);
      if (!locationId) {
        return {
          ok: false as const,
          status: 400 as const,
          message: "tenant has no active location",
        };
      }
      const device = await resolveActiveCaptureDevice(trx, principal.tenantId, locationId);
      if (!device) {
        return {
          ok: false as const,
          status: 400 as const,
          message: "location has no active capture device",
        };
      }

      const shotAt = new Date();
      const created = await createReferenceSet(trx, {
        tenantId: principal.tenantId,
        dishId: dish.id,
        dishVersionId: dish.current_version_id,
        createdBy: principal.userId,
        photos: body.photos.map((photo, index) => ({
          role: photo.role,
          storageKey: storageKeys[index] as string,
          captureDeviceId: device.id,
          captureProfileVersion: device.captureProfileVersion,
          shotAt,
          sortOrder: index,
        })),
      });

      // Activate inline (not @boca/db activateReferenceSet, which demands
      // exactly 3 primary; this flow allows >= 3): retire the prior active set
      // for the version, flip this one active, clear refs_stale.
      await trx
        .updateTable("reference_set")
        .set({ status: "retired", retired_at: shotAt })
        .where("tenant_id", "=", principal.tenantId)
        .where("dish_version_id", "=", dish.current_version_id)
        .where("status", "=", "active")
        .execute();
      await trx
        .updateTable("reference_set")
        .set({ status: "active", approved_by: principal.userId, approved_at: shotAt })
        .where("tenant_id", "=", principal.tenantId)
        .where("id", "=", created.referenceSetId)
        .execute();
      await trx
        .updateTable("dish")
        .set({ refs_stale: false })
        .where("tenant_id", "=", principal.tenantId)
        .where("id", "=", dish.id)
        .where("current_version_id", "=", dish.current_version_id)
        .execute();

      const detail = await this.loadReferenceSetDetail(
        trx,
        principal.tenantId,
        dish.id,
        dish.current_version_id,
      );
      return { ok: true as const, value: detail as ReferenceSetDetail };
    });
  }

  // --- Tolerances ----------------------------------------------------------
  async getTolerance(
    principal: Principal,
    dishId: string,
  ): Promise<ServiceResult<ToleranceCriteria | null>> {
    return withTenant(principal.tenantId, async (trx) => {
      const dish = await trx
        .selectFrom("dish")
        .select(["id"])
        .where("tenant_id", "=", principal.tenantId)
        .where("id", "=", dishId)
        .where("archived_at", "is", null)
        .executeTakeFirst();
      if (!dish) {
        return { ok: false as const, status: 404 as const, message: "dish not found" };
      }
      const active = await trx
        .selectFrom("tolerance_profile")
        .select(["criteria"])
        .where("tenant_id", "=", principal.tenantId)
        .where("dish_id", "=", dishId)
        .where("status", "=", "active")
        .executeTakeFirst();
      if (!active) {
        return { ok: true as const, value: null };
      }
      return { ok: true as const, value: this.criteriaFromDb(active.criteria) };
    });
  }

  async putTolerance(
    principal: Principal,
    dishId: string,
    criteria: ToleranceCriteria,
  ): Promise<ServiceResult<ToleranceCriteria>> {
    return withTenant(principal.tenantId, async (trx) => {
      const dish = await trx
        .selectFrom("dish")
        .select(["id"])
        .where("tenant_id", "=", principal.tenantId)
        .where("id", "=", dishId)
        .where("archived_at", "is", null)
        .executeTakeFirst();
      if (!dish) {
        return { ok: false as const, status: 404 as const, message: "dish not found" };
      }
      const maxRow = await trx
        .selectFrom("tolerance_profile")
        .select((eb) => eb.fn.max<number | null>("version_no").as("max_version"))
        .where("tenant_id", "=", principal.tenantId)
        .where("dish_id", "=", dishId)
        .executeTakeFirst();
      const versionNo = (maxRow?.max_version ?? 0) + 1;

      const now = new Date();
      await trx
        .updateTable("tolerance_profile")
        .set({ status: "retired", retired_at: now })
        .where("tenant_id", "=", principal.tenantId)
        .where("dish_id", "=", dishId)
        .where("status", "=", "active")
        .execute();
      await trx
        .insertInto("tolerance_profile")
        .values({
          tenant_id: principal.tenantId,
          dish_id: dishId,
          version_no: versionNo,
          criteria: JSON.stringify(this.criteriaToDb(criteria)),
          status: "active",
          activated_at: now,
          created_by: principal.userId,
        })
        .execute();

      return { ok: true as const, value: criteria };
    });
  }

  // --- Internal ------------------------------------------------------------
  private async loadDishDetail(
    trx: TenantTransaction,
    tenantId: string,
    dishId: string,
  ): Promise<AdminDishDetail | null> {
    const dish = await trx
      .selectFrom("dish")
      .select(["id", "menu_category_id", "refs_stale", "current_version_id"])
      .where("tenant_id", "=", tenantId)
      .where("id", "=", dishId)
      .where("archived_at", "is", null)
      .executeTakeFirst();
    if (!dish || !dish.current_version_id) {
      return null;
    }
    const version = await trx
      .selectFrom("dish_version")
      .selectAll()
      .where("tenant_id", "=", tenantId)
      .where("id", "=", dish.current_version_id)
      .executeTakeFirstOrThrow();

    const versionCountRow = await trx
      .selectFrom("dish_version")
      .select((eb) => eb.fn.countAll<string>().as("count"))
      .where("tenant_id", "=", tenantId)
      .where("dish_id", "=", dishId)
      .executeTakeFirstOrThrow();

    const refSets = await this.activeReferenceSetsByVersion(trx, tenantId, [
      dish.current_version_id,
    ]);
    const availability = await this.availabilityByDish(trx, tenantId, [dishId]);

    const toleranceRow = await trx
      .selectFrom("tolerance_profile")
      .select(["version_no"])
      .where("tenant_id", "=", tenantId)
      .where("dish_id", "=", dishId)
      .where("status", "=", "active")
      .executeTakeFirst();

    const heroPhotoUrl = version.hero_photo_key
      ? await this.storage.getSignedUrl(version.hero_photo_key)
      : null;

    return {
      id: dish.id,
      categoryId: dish.menu_category_id,
      name: parseBilingual(version.name),
      description: version.description === null ? null : parseBilingual(version.description),
      story: version.story === null ? null : parseBilingual(version.story),
      priceMinor: version.price_minor,
      vatRateBp: version.vat_rate_bp,
      allergenCodes: version.allergen_codes,
      stationId: version.station_id,
      heroPhotoUrl,
      non_scoreable: version.non_scoreable,
      refsStale: dish.refs_stale,
      currentVersionNo: version.version_no,
      versionCount: Number(versionCountRow.count),
      referenceSet: refSets.get(dish.current_version_id) ?? null,
      tolerance: toleranceRow
        ? { status: "active" as const, versionNo: toleranceRow.version_no }
        : null,
      availability: availability.get(dishId) ?? [],
    };
  }

  private async loadReferenceSetDetail(
    trx: TenantTransaction,
    tenantId: string,
    dishId: string,
    currentVersionId: string,
  ): Promise<ReferenceSetDetail | null> {
    // Prefer the active set on the current version; fall back to the newest
    // active set on an older version (reported as stale).
    const set = await trx
      .selectFrom("reference_set as rs")
      .innerJoin("dish_version as dv", (join) =>
        join.onRef("dv.id", "=", "rs.dish_version_id").onRef("dv.tenant_id", "=", "rs.tenant_id"),
      )
      .select([
        "rs.id as id",
        "rs.version_no as version_no",
        "rs.status as status",
        "rs.dish_version_id as dish_version_id",
        "dv.version_no as bound_version_no",
      ])
      .where("rs.tenant_id", "=", tenantId)
      .where("rs.dish_id", "=", dishId)
      .where("rs.status", "=", "active")
      .orderBy("dv.version_no", "desc")
      .executeTakeFirst();
    if (!set) {
      return null;
    }
    const photoRows = await trx
      .selectFrom("reference_photo")
      .select(["id", "role", "storage_key", "sort_order"])
      .where("tenant_id", "=", tenantId)
      .where("reference_set_id", "=", set.id)
      .orderBy("sort_order")
      .orderBy("id")
      .execute();
    const photos = await Promise.all(
      photoRows.map(async (p) => ({
        id: p.id,
        role: p.role,
        url: await this.storage.getSignedUrl(p.storage_key),
        sortOrder: p.sort_order,
      })),
    );
    return {
      referenceSetId: set.id,
      versionNo: set.version_no,
      status: set.status,
      staleness: {
        isStale: set.dish_version_id !== currentVersionId,
        boundToVersionNo: set.bound_version_no,
      },
      photos,
    };
  }

  private async resolveMediaKey(
    trx: TenantTransaction,
    tenantId: string,
    mediaId: string,
  ): Promise<string | undefined> {
    const row = await trx
      .selectFrom("media_asset")
      .select(["storage_key"])
      .where("tenant_id", "=", tenantId)
      .where("id", "=", mediaId)
      .executeTakeFirst();
    return row?.storage_key;
  }

  private async activeReferenceSetsByVersion(
    trx: TenantTransaction,
    tenantId: string,
    versionIds: string[],
  ): Promise<Map<string, { status: "active"; versionNo: number; photoCount: number }>> {
    const map = new Map<string, { status: "active"; versionNo: number; photoCount: number }>();
    if (versionIds.length === 0) {
      return map;
    }
    const rows = await trx
      .selectFrom("reference_set as rs")
      .leftJoin("reference_photo as rp", (join) =>
        join.onRef("rp.reference_set_id", "=", "rs.id").onRef("rp.tenant_id", "=", "rs.tenant_id"),
      )
      .select((eb) => [
        "rs.dish_version_id as dish_version_id",
        "rs.version_no as version_no",
        eb.fn.count<string>("rp.id").as("photo_count"),
      ])
      .where("rs.tenant_id", "=", tenantId)
      .where("rs.dish_version_id", "in", versionIds)
      .where("rs.status", "=", "active")
      .groupBy(["rs.dish_version_id", "rs.version_no"])
      .execute();
    for (const row of rows) {
      map.set(row.dish_version_id, {
        status: "active",
        versionNo: row.version_no,
        photoCount: Number(row.photo_count),
      });
    }
    return map;
  }

  private async availabilityByDish(
    trx: TenantTransaction,
    tenantId: string,
    dishIds: string[],
  ): Promise<Map<string, DishAvailabilityEntry[]>> {
    const map = new Map<string, DishAvailabilityEntry[]>();
    if (dishIds.length === 0) {
      return map;
    }
    const rows = await trx
      .selectFrom("dish_location_availability")
      .select(["dish_id", "location_id", "is_86ed"])
      .where("tenant_id", "=", tenantId)
      .where("dish_id", "in", dishIds)
      .execute();
    for (const row of rows) {
      const list = map.get(row.dish_id) ?? [];
      list.push({ locationId: row.location_id, is86ed: row.is_86ed });
      map.set(row.dish_id, list);
    }
    return map;
  }

  private criteriaToDb(criteria: ToleranceCriteria): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const key of TOLERANCE_KEYS) {
      const entry = criteria[key];
      out[key] = {
        allowed_variance: toDbVariance(entry.allowedVariance),
        must_have: [],
        notes_ro: entry.notesRo,
      };
    }
    return out;
  }

  private criteriaFromDb(value: unknown): ToleranceCriteria {
    const map = (typeof value === "object" && value !== null ? value : {}) as Record<
      string,
      { allowed_variance?: unknown; notes_ro?: unknown }
    >;
    const build = (key: (typeof TOLERANCE_KEYS)[number]) => {
      const entry = map[key] ?? {};
      return {
        allowedVariance: fromDbVariance(entry.allowed_variance),
        notesRo: typeof entry.notes_ro === "string" ? entry.notes_ro : "",
      };
    };
    return {
      components: build("components"),
      arrangement: build("arrangement"),
      sauce: build("sauce"),
      cleanliness: build("cleanliness"),
      color: build("color"),
      portion: build("portion"),
    };
  }
}
