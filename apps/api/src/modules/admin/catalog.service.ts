import { randomBytes } from "node:crypto";
import type {
  AdminAllergen,
  AdminCategory,
  AdminServiceRequest,
  AdminSettings,
  AdminStation,
  AdminTable,
  AdminUser,
  CreateCategoryRequest,
  CreateStationRequest,
  CreateTableRequest,
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
      return (
        categories
          // "Demo AI" is an internal fixture category the evaluation sandbox
          // creates; it is not a real menu category, so keep it out of the CMS.
          .filter((c) => parseBilingual(c.name).ro !== "Demo AI")
          .map((c) => ({
            id: c.id,
            name: parseBilingual(c.name),
            sortOrder: c.sort_order,
            dishCount: counts.get(c.id) ?? 0,
          }))
      );
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
      // Guard: an archived category with live dishes would orphan them (they keep
      // menu_category_id but vanish from the grouped menu). Require it empty first.
      const active = await trx
        .selectFrom("dish")
        .select((eb) => eb.fn.countAll<string>().as("n"))
        .where("tenant_id", "=", principal.tenantId)
        .where("menu_category_id", "=", id)
        .where("archived_at", "is", null)
        .executeTakeFirst();
      const dishCount = Number(active?.n ?? 0);
      if (dishCount > 0) {
        return {
          ok: false as const,
          status: 409 as const,
          message: `Categoria are ${dishCount} preparate active. Șterge sau mută preparatele întâi.`,
        };
      }
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
    if (id === principal.userId) {
      return { ok: false, status: 409, message: "Nu îți poți dezactiva propriul cont." };
    }
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

  /**
   * Hard-delete a user. Only works for accounts with NO activity — a user who
   * created dishes / accepted orders / shot pass photos is FK-referenced
   * (RESTRICT), so the delete raises 23503 and we return 409 (deactivate
   * instead). Can't delete your own account.
   */
  async deleteUser(principal: Principal, id: string): Promise<ServiceResult<{ ok: true }>> {
    if (id === principal.userId) {
      return { ok: false, status: 409, message: "Nu îți poți șterge propriul cont." };
    }
    try {
      return await withTenant(principal.tenantId, async (trx) => {
        const existing = await trx
          .selectFrom("app_user")
          .select("id")
          .where("tenant_id", "=", principal.tenantId)
          .where("id", "=", id)
          .executeTakeFirst();
        if (!existing) {
          return { ok: false as const, status: 404 as const, message: "user not found" };
        }
        await trx
          .deleteFrom("app_user")
          .where("tenant_id", "=", principal.tenantId)
          .where("id", "=", id)
          .execute();
        return { ok: true as const, value: { ok: true as const } };
      });
    } catch (error) {
      // 23503 = FK violation: the user has activity in the system.
      if (
        error &&
        typeof error === "object" &&
        "code" in error &&
        (error as { code?: string }).code === "23503"
      ) {
        return {
          ok: false,
          status: 409,
          message: "Utilizatorul are activitate în sistem — dezactivează-l în schimb.",
        };
      }
      throw error;
    }
  }

  // --- Tables + QR ---------------------------------------------------------

  async listTables(principal: Principal): Promise<AdminTable[]> {
    return withTenant(principal.tenantId, async (trx) => {
      const rows = await trx
        .selectFrom("dining_table as dt")
        .leftJoin("table_qr_slug as q", (join) =>
          join
            .onRef("q.dining_table_id", "=", "dt.id")
            .onRef("q.tenant_id", "=", "dt.tenant_id")
            .on("q.revoked_at", "is", null),
        )
        .leftJoin("table_session as ts", (join) =>
          join
            .onRef("ts.dining_table_id", "=", "dt.id")
            .onRef("ts.tenant_id", "=", "dt.tenant_id")
            .on("ts.status", "in", ["open", "bill_requested"])
            .on("ts.expires_at", ">", new Date()),
        )
        .innerJoin("floor_section as fs", (join) =>
          join
            .onRef("fs.id", "=", "dt.floor_section_id")
            .onRef("fs.tenant_id", "=", "dt.tenant_id"),
        )
        .select((eb) => [
          "dt.id",
          "dt.label",
          "dt.seats",
          "q.slug",
          "fs.name as section",
          eb("ts.id", "is not", null).as("occupied"),
        ])
        .where("dt.tenant_id", "=", principal.tenantId)
        .where("dt.archived_at", "is", null)
        .orderBy("dt.label")
        .execute();
      return rows.map((r) => ({
        id: r.id,
        label: r.label,
        seats: r.seats,
        qrSlug: r.slug,
        occupied: Boolean(r.occupied),
        section: r.section,
      }));
    });
  }

  /** Open floor service requests (guest pressed call-waiter / request-bill). */
  async listServiceRequests(principal: Principal): Promise<AdminServiceRequest[]> {
    return withTenant(principal.tenantId, async (trx) => {
      const rows = await trx
        .selectFrom("service_request as sr")
        .innerJoin("dining_table as dt", (join) =>
          join.onRef("dt.id", "=", "sr.dining_table_id").onRef("dt.tenant_id", "=", "sr.tenant_id"),
        )
        .select(["sr.id", "sr.kind", "sr.created_at", "dt.label as table_label"])
        .where("sr.tenant_id", "=", principal.tenantId)
        .where("sr.status", "in", ["open", "escalated"])
        .orderBy("sr.created_at")
        .execute();
      return rows.map((r) => ({
        id: r.id,
        tableLabel: r.table_label,
        kind: r.kind,
        createdAt: r.created_at.toISOString(),
      }));
    });
  }

  /** Acknowledge/resolve a service request (waiter took the table). */
  async resolveServiceRequest(
    principal: Principal,
    id: string,
  ): Promise<ServiceResult<{ ok: true }>> {
    return withTenant(principal.tenantId, async (trx) => {
      const updated = await trx
        .updateTable("service_request")
        .set({ status: "resolved", resolved_at: new Date(), acknowledged_by: principal.userId })
        .where("tenant_id", "=", principal.tenantId)
        .where("id", "=", id)
        .where("status", "in", ["open", "escalated"])
        .executeTakeFirst();
      if (updated.numUpdatedRows === 0n) {
        return { ok: false as const, status: 404 as const, message: "request not found" };
      }
      return { ok: true as const, value: { ok: true as const } };
    });
  }

  /** Close the table's open session (staff "clears" the table). Revokes its
   *  device tokens so the next guest scan starts a brand-new session. */
  async closeTable(principal: Principal, id: string): Promise<ServiceResult<{ ok: true }>> {
    return withTenant(principal.tenantId, async (trx) => {
      const table = await trx
        .selectFrom("dining_table")
        .select("id")
        .where("tenant_id", "=", principal.tenantId)
        .where("id", "=", id)
        .where("archived_at", "is", null)
        .executeTakeFirst();
      if (!table) {
        return { ok: false as const, status: 404 as const, message: "table not found" };
      }
      const sessions = await trx
        .selectFrom("table_session")
        .select("id")
        .where("tenant_id", "=", principal.tenantId)
        .where("dining_table_id", "=", id)
        .where("status", "in", ["open", "bill_requested"])
        .execute();
      const now = new Date();
      for (const s of sessions) {
        await trx
          .updateTable("table_session")
          .set({ status: "closed", closed_at: now })
          .where("tenant_id", "=", principal.tenantId)
          .where("id", "=", s.id)
          .execute();
        await trx
          .updateTable("session_device_token")
          .set({ revoked_at: now })
          .where("tenant_id", "=", principal.tenantId)
          .where("table_session_id", "=", s.id)
          .where("revoked_at", "is", null)
          .execute();
      }
      return { ok: true as const, value: { ok: true as const } };
    });
  }

  async createTable(
    principal: Principal,
    body: CreateTableRequest,
  ): Promise<ServiceResult<AdminTable>> {
    return withTenant(principal.tenantId, async (trx) => {
      const location = await trx
        .selectFrom("location")
        .select(["id"])
        .where("tenant_id", "=", principal.tenantId)
        .where("archived_at", "is", null)
        .orderBy("created_at")
        .executeTakeFirst();
      if (!location) {
        return { ok: false as const, status: 400 as const, message: "no active location" };
      }
      // Reject duplicate label up front (UNIQUE(tenant,location,label) covers
      // archived rows too, so check without the archived filter).
      const dupe = await trx
        .selectFrom("dining_table")
        .select("id")
        .where("tenant_id", "=", principal.tenantId)
        .where("location_id", "=", location.id)
        .where("label", "=", body.label)
        .executeTakeFirst();
      if (dupe) {
        return {
          ok: false as const,
          status: 409 as const,
          message: "O masă cu acest nume există deja.",
        };
      }
      // Ensure a default floor section for the location.
      const existingSection = await trx
        .selectFrom("floor_section")
        .select(["id", "name"])
        .where("tenant_id", "=", principal.tenantId)
        .where("location_id", "=", location.id)
        .where("archived_at", "is", null)
        .orderBy("sort_order")
        .executeTakeFirst();
      const sectionName = existingSection?.name ?? "Sală principală";
      const sectionId =
        existingSection?.id ??
        (
          await trx
            .insertInto("floor_section")
            .values({
              tenant_id: principal.tenantId,
              location_id: location.id,
              name: sectionName,
            })
            .returning("id")
            .executeTakeFirstOrThrow()
        ).id;

      const table = await trx
        .insertInto("dining_table")
        .values({
          tenant_id: principal.tenantId,
          location_id: location.id,
          floor_section_id: sectionId,
          label: body.label,
          seats: body.seats ?? null,
        })
        .returning("id")
        .executeTakeFirstOrThrow();

      // Unguessable QR slug (embedded in the printed QR, never typed).
      const slug = randomBytes(16).toString("base64url");
      await trx
        .insertInto("table_qr_slug")
        .values({ tenant_id: principal.tenantId, dining_table_id: table.id, slug })
        .execute();

      return {
        ok: true as const,
        value: {
          id: table.id,
          label: body.label,
          seats: body.seats ?? null,
          qrSlug: slug,
          occupied: false,
          section: sectionName,
        },
      };
    });
  }

  async deleteTable(principal: Principal, id: string): Promise<ServiceResult<{ ok: true }>> {
    return withTenant(principal.tenantId, async (trx) => {
      const updated = await trx
        .updateTable("dining_table")
        .set({ archived_at: new Date() })
        .where("tenant_id", "=", principal.tenantId)
        .where("id", "=", id)
        .where("archived_at", "is", null)
        .executeTakeFirst();
      if (updated.numUpdatedRows === 0n) {
        return { ok: false as const, status: 404 as const, message: "table not found" };
      }
      // Revoke the active QR slug so the printed code stops working.
      await trx
        .updateTable("table_qr_slug")
        .set({ revoked_at: new Date(), revoked_by: principal.userId })
        .where("tenant_id", "=", principal.tenantId)
        .where("dining_table_id", "=", id)
        .where("revoked_at", "is", null)
        .execute();
      return { ok: true as const, value: { ok: true as const } };
    });
  }
}
