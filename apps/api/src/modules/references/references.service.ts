import {
  bilingualTextSchema,
  type CreateDemoDishRequest,
  type CreateDemoDishResponse,
  type DemoDish,
  type ReferenceSetSummary,
} from "@boca/contracts";
import {
  activateReferenceSet,
  createDemoDish,
  createReferenceSet,
  DEMO_CAPTURE_PROFILE_VERSION,
  ensureDefaultToleranceProfile,
  ensureDemoFixtures,
  getActiveReferenceSetForDishVersion,
  getReferencePhotoCount,
  listDishesWithReferenceStatus,
  type ReferencePhotoInput,
  withTenant,
} from "@boca/db";
import { Injectable } from "@nestjs/common";
import type { Principal } from "../../common/principal";
import { resolveLocationId, type ServiceResult } from "../evaluation/evaluation.service";
import { isOwnDemoPhotoKey } from "../storage/keys";
import { StorageService } from "../storage/storage.service";

// Demo dishes are priced at 0 RON / 0bp VAT: the synthetic order_item chain
// snapshots these values but no money ever flows through the demo.
const DEMO_PRICE_MINOR = 0;
const DEMO_VAT_RATE_BP = 0;

@Injectable()
export class ReferencesService {
  constructor(private readonly storage: StorageService) {}

  /** Ad-hoc demo dish: dish + dish_version v1 + default tolerance profile. */
  async createDemoDish(
    principal: Principal,
    request: CreateDemoDishRequest,
  ): Promise<ServiceResult<CreateDemoDishResponse>> {
    return withTenant(principal.tenantId, async (trx) => {
      const locationId = await resolveLocationId(trx, principal);
      if (!locationId) {
        return {
          ok: false as const,
          status: 400 as const,
          message: "tenant has no active location",
        };
      }
      const fixtures = await ensureDemoFixtures(trx, { tenantId: principal.tenantId, locationId });
      const created = await createDemoDish(trx, {
        tenantId: principal.tenantId,
        menuCategoryId: fixtures.menuCategoryId,
        stationId: fixtures.stationId,
        createdBy: principal.userId,
        name: request.name,
        priceMinor: DEMO_PRICE_MINOR,
        vatRateBp: DEMO_VAT_RATE_BP,
      });
      // ai_evaluation's completed-CHECK demands a pinned tolerance profile;
      // the default one (color starts 'wide') exists from day zero.
      await ensureDefaultToleranceProfile(trx, {
        tenantId: principal.tenantId,
        dishId: created.dishId,
        createdBy: principal.userId,
      });
      return {
        ok: true as const,
        value: { dishId: created.dishId, dishVersionId: created.dishVersionId },
      };
    });
  }

  async listDemoDishes(principal: Principal): Promise<DemoDish[]> {
    return withTenant(principal.tenantId, async (trx) => {
      const rows = await listDishesWithReferenceStatus(trx);
      // listDishesWithReferenceStatus does not project created_at — small
      // supplemental map (demo scale); candidate to fold into @boca/db later.
      const createdAtRows = await trx
        .selectFrom("dish")
        .select(["id", "created_at"])
        .where("archived_at", "is", null)
        .execute();
      const createdAtById = new Map(createdAtRows.map((row) => [row.id, row.created_at]));

      const dishes: DemoDish[] = [];
      for (const row of rows) {
        if (!row.current_version_id) {
          continue; // unreachable for demo dishes (version created in same tx)
        }
        const name = bilingualTextSchema.safeParse(row.name);
        if (!name.success) {
          continue;
        }
        let referenceSet: ReferenceSetSummary | null = null;
        if (row.active_reference_set_id) {
          const active = await getActiveReferenceSetForDishVersion(trx, row.current_version_id);
          if (active) {
            referenceSet = {
              referenceSetId: active.set.id,
              versionNo: active.set.version_no,
              status: active.set.status,
              photoCount: active.photos.length,
            };
          }
        }
        dishes.push({
          id: row.dish_id,
          dishVersionId: row.current_version_id,
          name: name.data,
          referenceSet,
          createdAt: (createdAtById.get(row.dish_id) ?? new Date(0)).toISOString(),
        });
      }
      return dishes;
    });
  }

  /**
   * Attach 1-5 uploaded photos as a NEW ACTIVE reference set: draft set with
   * immutable photo rows (first N = primary REF1..REFn per the tenant's
   * configured reference photo count, rest = holdout), then explicit
   * activation (retires the prior active set, clears refs_stale).
   */
  async attachReferences(
    principal: Principal,
    dishId: string,
    imageKeys: string[],
  ): Promise<ServiceResult<ReferenceSetSummary>> {
    const foreignKeys = imageKeys.filter((key) => !isOwnDemoPhotoKey(principal.tenantId, key));
    if (foreignKeys.length > 0) {
      return {
        ok: false,
        status: 400,
        message: `not demo upload keys of this tenant: ${foreignKeys.join(", ")}`,
      };
    }
    const missing: string[] = [];
    for (const key of imageKeys) {
      if (!(await this.storage.exists(key))) {
        missing.push(key);
      }
    }
    if (missing.length > 0) {
      return { ok: false, status: 400, message: `unknown imageKeys: ${missing.join(", ")}` };
    }

    return withTenant(principal.tenantId, async (trx) => {
      const dish = await trx
        .selectFrom("dish")
        .select(["id", "current_version_id"])
        .where("id", "=", dishId)
        .where("archived_at", "is", null)
        .executeTakeFirst();
      if (!dish) {
        return { ok: false as const, status: 404 as const, message: "dish not found" };
      }
      if (!dish.current_version_id) {
        return { ok: false as const, status: 400 as const, message: "dish has no current version" };
      }
      const locationId = await resolveLocationId(trx, principal);
      if (!locationId) {
        return {
          ok: false as const,
          status: 400 as const,
          message: "tenant has no active location",
        };
      }
      const fixtures = await ensureDemoFixtures(trx, { tenantId: principal.tenantId, locationId });

      const primaryCount = await getReferencePhotoCount(trx);
      if (imageKeys.length < primaryCount) {
        return {
          ok: false as const,
          status: 400 as const,
          message: `at least ${primaryCount} photo(s) required by tenant settings, got ${imageKeys.length}`,
        };
      }

      const shotAt = new Date();
      const photos: ReferencePhotoInput[] = imageKeys.map((storageKey, index) => ({
        role: index < primaryCount ? "primary" : "holdout",
        storageKey,
        captureDeviceId: fixtures.captureDeviceId,
        captureProfileVersion: DEMO_CAPTURE_PROFILE_VERSION,
        shotAt,
        sortOrder: index,
      }));

      const created = await createReferenceSet(trx, {
        tenantId: principal.tenantId,
        dishId: dish.id,
        dishVersionId: dish.current_version_id,
        createdBy: principal.userId,
        photos,
      });
      await activateReferenceSet(trx, {
        referenceSetId: created.referenceSetId,
        approvedBy: principal.userId,
        requiredPrimaryCount: primaryCount,
      });
      await ensureDefaultToleranceProfile(trx, {
        tenantId: principal.tenantId,
        dishId: dish.id,
        createdBy: principal.userId,
      });

      return {
        ok: true as const,
        value: {
          referenceSetId: created.referenceSetId,
          versionNo: created.versionNo,
          status: "active" as const,
          photoCount: photos.length,
        },
      };
    });
  }
}
