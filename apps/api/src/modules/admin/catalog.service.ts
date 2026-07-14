import type {
  AdminAllergen,
  AdminCategory,
  AdminSettings,
  AdminStation,
  AdminUser,
  CreateCategoryRequest,
  CreateStationRequest,
  CreateUserRequest,
  UpdateCategoryRequest,
  UpdateLocationRequest,
  UpdateStationRequest,
  UpdateTenantRequest,
} from "@boca/contracts";
import { type TenantTransaction, withTenant } from "@boca/db";
import { Injectable } from "@nestjs/common";
import * as argon2 from "argon2";
import type { Principal } from "../../common/principal";
import type { ServiceResult } from "../evaluation/evaluation.service";
import { parseBilingual } from "./admin.helpers";

@Injectable()
export class CatalogService {
  // --- Allergens -----------------------------------------------------------
  async listAllergens(principal: Principal): Promise<AdminAllergen[]> {
    return withTenant(principal.tenantId, async (trx) => {
      const rows = await trx
        .selectFrom("allergen")
        .select(["code", "name"])
        .orderBy("code")
        .execute();
      return rows.map((row) => ({ code: row.code, name: parseBilingual(row.name) }));
    });
  }

  // --- Categories ----------------------------------------------------------
  async listCategories(principal: Principal): Promise<AdminCategory[]> {
    return withTenant(principal.tenantId, async (trx) => {
      const categories = await trx
        .selectFrom("menu_category")
        .select(["id", "name", "sort_order"])
        .where("tenant_id", "=", principal.tenantId)
        .where("archived_at", "is", null)
        .orderBy("sort_order")
        .orderBy("created_at")
        .execute();
      const counts = await this.dishCountsByCategory(trx, principal.tenantId);
      return categories.map((c) => ({
        id: c.id,
        name: parseBilingual(c.name),
        sortOrder: c.sort_order,
        dishCount: counts.get(c.id) ?? 0,
      }));
    });
  }

  async createCategory(
    principal: Principal,
    body: CreateCategoryRequest,
  ): Promise<ServiceResult<AdminCategory>> {
    return withTenant(principal.tenantId, async (trx) => {
      const inserted = await trx
        .insertInto("menu_category")
        .values({
          tenant_id: principal.tenantId,
          name: JSON.stringify(body.name),
          ...(body.sortOrder === undefined ? {} : { sort_order: body.sortOrder }),
        })
        .returning(["id", "name", "sort_order"])
        .executeTakeFirstOrThrow();
      return {
        ok: true as const,
        value: {
          id: inserted.id,
          name: parseBilingual(inserted.name),
          sortOrder: inserted.sort_order,
          dishCount: 0,
        },
      };
    });
  }

  async updateCategory(
    principal: Principal,
    id: string,
    body: UpdateCategoryRequest,
  ): Promise<ServiceResult<AdminCategory>> {
    return withTenant(principal.tenantId, async (trx) => {
      const existing = await trx
        .selectFrom("menu_category")
        .select(["id"])
        .where("tenant_id", "=", principal.tenantId)
        .where("id", "=", id)
        .where("archived_at", "is", null)
        .executeTakeFirst();
      if (!existing) {
        return { ok: false as const, status: 404 as const, message: "category not found" };
      }
      const patch: { name?: string; sort_order?: number } = {};
      if (body.name !== undefined) {
        patch.name = JSON.stringify(body.name);
      }
      if (body.sortOrder !== undefined) {
        patch.sort_order = body.sortOrder;
      }
      if (Object.keys(patch).length > 0) {
        await trx
          .updateTable("menu_category")
          .set(patch)
          .where("tenant_id", "=", principal.tenantId)
          .where("id", "=", id)
          .execute();
      }
      const row = await trx
        .selectFrom("menu_category")
        .select(["id", "name", "sort_order"])
        .where("tenant_id", "=", principal.tenantId)
        .where("id", "=", id)
        .executeTakeFirstOrThrow();
      const counts = await this.dishCountsByCategory(trx, principal.tenantId);
      return {
        ok: true as const,
        value: {
          id: row.id,
          name: parseBilingual(row.name),
          sortOrder: row.sort_order,
          dishCount: counts.get(row.id) ?? 0,
        },
      };
    });
  }

  async archiveCategory(principal: Principal, id: string): Promise<ServiceResult<{ ok: true }>> {
    return withTenant(principal.tenantId, async (trx) => {
      const updated = await trx
        .updateTable("menu_category")
        .set({ archived_at: new Date() })
        .where("tenant_id", "=", principal.tenantId)
        .where("id", "=", id)
        .where("archived_at", "is", null)
        .executeTakeFirst();
      if (updated.numUpdatedRows === 0n) {
        return { ok: false as const, status: 404 as const, message: "category not found" };
      }
      return { ok: true as const, value: { ok: true as const } };
    });
  }

  private async dishCountsByCategory(
    trx: TenantTransaction,
    tenantId: string,
  ): Promise<Map<string, number>> {
    const rows = await trx
      .selectFrom("dish")
      .select((eb) => ["menu_category_id", eb.fn.countAll<string>().as("count")])
      .where("tenant_id", "=", tenantId)
      .where("archived_at", "is", null)
      .groupBy("menu_category_id")
      .execute();
    return new Map(rows.map((r) => [r.menu_category_id, Number(r.count)]));
  }

  // --- Stations ------------------------------------------------------------
  async listStations(principal: Principal): Promise<AdminStation[]> {
    return withTenant(principal.tenantId, (trx) => this.selectStations(trx, principal.tenantId));
  }

  async createStation(
    principal: Principal,
    body: CreateStationRequest,
  ): Promise<ServiceResult<AdminStation>> {
    return withTenant(principal.tenantId, async (trx) => {
      const clash = await trx
        .selectFrom("station")
        .select(["id"])
        .where("tenant_id", "=", principal.tenantId)
        .where("code", "=", body.code)
        .executeTakeFirst();
      if (clash) {
        return {
          ok: false as const,
          status: 400 as const,
          message: `station code '${body.code}' already exists`,
        };
      }
      const inserted = await trx
        .insertInto("station")
        .values({ tenant_id: principal.tenantId, code: body.code, name: JSON.stringify(body.name) })
        .returning(["id", "code", "name"])
        .executeTakeFirstOrThrow();
      return {
        ok: true as const,
        value: { id: inserted.id, code: inserted.code, name: parseBilingual(inserted.name) },
      };
    });
  }

  async updateStation(
    principal: Principal,
    id: string,
    body: UpdateStationRequest,
  ): Promise<ServiceResult<AdminStation>> {
    return withTenant(principal.tenantId, async (trx) => {
      const existing = await trx
        .selectFrom("station")
        .select(["id"])
        .where("tenant_id", "=", principal.tenantId)
        .where("id", "=", id)
        .where("archived_at", "is", null)
        .executeTakeFirst();
      if (!existing) {
        return { ok: false as const, status: 404 as const, message: "station not found" };
      }
      if (body.code !== undefined) {
        const clash = await trx
          .selectFrom("station")
          .select(["id"])
          .where("tenant_id", "=", principal.tenantId)
          .where("code", "=", body.code)
          .where("id", "!=", id)
          .executeTakeFirst();
        if (clash) {
          return {
            ok: false as const,
            status: 400 as const,
            message: `station code '${body.code}' already exists`,
          };
        }
      }
      const patch: { code?: string; name?: string } = {};
      if (body.code !== undefined) {
        patch.code = body.code;
      }
      if (body.name !== undefined) {
        patch.name = JSON.stringify(body.name);
      }
      if (Object.keys(patch).length > 0) {
        await trx
          .updateTable("station")
          .set(patch)
          .where("tenant_id", "=", principal.tenantId)
          .where("id", "=", id)
          .execute();
      }
      const row = await trx
        .selectFrom("station")
        .select(["id", "code", "name"])
        .where("tenant_id", "=", principal.tenantId)
        .where("id", "=", id)
        .executeTakeFirstOrThrow();
      return {
        ok: true as const,
        value: { id: row.id, code: row.code, name: parseBilingual(row.name) },
      };
    });
  }

  private async selectStations(trx: TenantTransaction, tenantId: string): Promise<AdminStation[]> {
    const rows = await trx
      .selectFrom("station")
      .select(["id", "code", "name"])
      .where("tenant_id", "=", tenantId)
      .where("archived_at", "is", null)
      .orderBy("code")
      .execute();
    return rows.map((r) => ({ id: r.id, code: r.code, name: parseBilingual(r.name) }));
  }

  // --- Settings ------------------------------------------------------------
  async getSettings(principal: Principal): Promise<ServiceResult<AdminSettings>> {
    return withTenant(principal.tenantId, async (trx) => {
      const settings = await this.buildSettings(trx, principal.tenantId);
      if (!settings) {
        return { ok: false as const, status: 404 as const, message: "tenant not found" };
      }
      return { ok: true as const, value: settings };
    });
  }

  async updateTenant(
    principal: Principal,
    body: UpdateTenantRequest,
  ): Promise<ServiceResult<AdminSettings>> {
    return withTenant(principal.tenantId, async (trx) => {
      await trx
        .updateTable("tenant")
        .set({ name: body.name })
        .where("id", "=", principal.tenantId)
        .execute();
      const settings = await this.buildSettings(trx, principal.tenantId);
      if (!settings) {
        return { ok: false as const, status: 404 as const, message: "tenant not found" };
      }
      return { ok: true as const, value: settings };
    });
  }

  async updateLocation(
    principal: Principal,
    id: string,
    body: UpdateLocationRequest,
  ): Promise<ServiceResult<AdminSettings>> {
    return withTenant(principal.tenantId, async (trx) => {
      const existing = await trx
        .selectFrom("location")
        .select(["id"])
        .where("tenant_id", "=", principal.tenantId)
        .where("id", "=", id)
        .where("archived_at", "is", null)
        .executeTakeFirst();
      if (!existing) {
        return { ok: false as const, status: 404 as const, message: "location not found" };
      }
      const patch: { name?: string; timezone?: string; address?: string | null } = {};
      if (body.name !== undefined) {
        patch.name = body.name;
      }
      if (body.timezone !== undefined) {
        patch.timezone = body.timezone;
      }
      if (body.address !== undefined) {
        patch.address = body.address;
      }
      if (Object.keys(patch).length > 0) {
        await trx
          .updateTable("location")
          .set(patch)
          .where("tenant_id", "=", principal.tenantId)
          .where("id", "=", id)
          .execute();
      }
      const settings = await this.buildSettings(trx, principal.tenantId);
      if (!settings) {
        return { ok: false as const, status: 404 as const, message: "tenant not found" };
      }
      return { ok: true as const, value: settings };
    });
  }

  private async buildSettings(
    trx: TenantTransaction,
    tenantId: string,
  ): Promise<AdminSettings | null> {
    const tenant = await trx
      .selectFrom("tenant")
      .select(["name", "slug"])
      .where("id", "=", tenantId)
      .where("archived_at", "is", null)
      .executeTakeFirst();
    if (!tenant) {
      return null;
    }
    const locations = await trx
      .selectFrom("location")
      .select(["id", "name", "timezone", "address"])
      .where("tenant_id", "=", tenantId)
      .where("archived_at", "is", null)
      .orderBy("name")
      .execute();
    const stations = await this.selectStations(trx, tenantId);
    return {
      tenant: { name: tenant.name, slug: tenant.slug },
      locations: locations.map((l) => ({
        id: l.id,
        name: l.name,
        timezone: l.timezone,
        address: l.address,
      })),
      stations,
    };
  }

  // --- Users ---------------------------------------------------------------
  async listUsers(principal: Principal): Promise<AdminUser[]> {
    return withTenant(principal.tenantId, async (trx) => {
      const rows = await trx
        .selectFrom("app_user")
        .select(["id", "email", "full_name", "role", "location_id", "is_active"])
        .where("tenant_id", "=", principal.tenantId)
        .orderBy("full_name")
        .execute();
      return rows.map((r) => ({
        id: r.id,
        email: r.email,
        fullName: r.full_name,
        role: r.role,
        locationId: r.location_id,
        isActive: r.is_active,
      }));
    });
  }

  async createUser(
    principal: Principal,
    body: CreateUserRequest,
  ): Promise<ServiceResult<AdminUser>> {
    const passwordHash = await argon2.hash(body.password);
    return withTenant(principal.tenantId, async (trx) => {
      const clash = await trx
        .selectFrom("app_user")
        .select(["id"])
        .where("tenant_id", "=", principal.tenantId)
        .where("email", "=", body.email)
        .executeTakeFirst();
      if (clash) {
        return {
          ok: false as const,
          status: 400 as const,
          message: `email '${body.email}' already in use`,
        };
      }
      const inserted = await trx
        .insertInto("app_user")
        .values({
          tenant_id: principal.tenantId,
          email: body.email,
          full_name: body.fullName,
          role: body.role,
          location_id: body.locationId ?? null,
          password_hash: passwordHash,
        })
        .returning(["id", "email", "full_name", "role", "location_id", "is_active"])
        .executeTakeFirstOrThrow();
      return {
        ok: true as const,
        value: {
          id: inserted.id,
          email: inserted.email,
          fullName: inserted.full_name,
          role: inserted.role,
          locationId: inserted.location_id,
          isActive: inserted.is_active,
        },
      };
    });
  }

  async deactivateUser(principal: Principal, id: string): Promise<ServiceResult<{ ok: true }>> {
    return withTenant(principal.tenantId, async (trx) => {
      const updated = await trx
        .updateTable("app_user")
        .set({ is_active: false })
        .where("tenant_id", "=", principal.tenantId)
        .where("id", "=", id)
        .executeTakeFirst();
      if (updated.numUpdatedRows === 0n) {
        return { ok: false as const, status: 404 as const, message: "user not found" };
      }
      return { ok: true as const, value: { ok: true as const } };
    });
  }
}
