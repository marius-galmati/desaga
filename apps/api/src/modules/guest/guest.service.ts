import { createHash, randomBytes } from "node:crypto";
import type {
  GuestMenu,
  GuestMenuDish,
  GuestOrder,
  GuestSession,
  GuestTable,
  PlaceOrderRequest,
  ServiceRequestKind,
} from "@boca/contracts";
import {
  resolveQrSlug,
  resolveSessionToken,
  resolveTenantIdBySlug,
  type TenantTransaction,
  withTenant,
} from "@boca/db";
import { Injectable } from "@nestjs/common";
import { parseBilingual } from "../admin/admin.helpers";
import { StorageService } from "../storage/storage.service";

const SESSION_TTL_MS = 3 * 60 * 60 * 1000; // 3h sliding tab, matches schema note

// Playful, non-identifying table personas (guests are NOT users).
const GUEST_PERSONAS: readonly { name: string; emoji: string }[] = [
  { name: "Vulpe", emoji: "🦊" },
  { name: "Cerb", emoji: "🦌" },
  { name: "Bufniță", emoji: "🦉" },
  { name: "Urs", emoji: "🐻" },
  { name: "Veveriță", emoji: "🐿️" },
  { name: "Rândunică", emoji: "🐦" },
  { name: "Arici", emoji: "🦔" },
  { name: "Lup", emoji: "🐺" },
];

function sha256(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

// Guest-facing result: ok + value, or a status the controller maps to HTTP.
type GuestResult<T> = { ok: true; value: T } | { ok: false; status: 400 | 401; message: string };

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

  /** Tables + their active QR slug, for the table picker (no physical QR yet). */
  async getTables(tenantSlug: string): Promise<GuestTable[] | null> {
    const tenantId = await resolveTenantIdBySlug(tenantSlug);
    if (!tenantId) {
      return null;
    }
    return withTenant(tenantId, async (trx) => {
      const rows = await trx
        .selectFrom("dining_table as dt")
        .innerJoin("table_qr_slug as q", (join) =>
          join.onRef("q.dining_table_id", "=", "dt.id").onRef("q.tenant_id", "=", "dt.tenant_id"),
        )
        .select(["dt.label", "q.slug"])
        .where("dt.tenant_id", "=", tenantId)
        .where("dt.archived_at", "is", null)
        .where("q.revoked_at", "is", null)
        .orderBy("dt.label")
        .execute();
      return rows.map((r) => ({ label: r.label, qrSlug: r.slug }));
    });
  }

  // --- Ordering (Phase 2) --------------------------------------------------

  /** Open (or join) a table's shared session from a scanned QR slug. */
  async startSession(qrSlug: string): Promise<GuestSession | null> {
    const resolved = await resolveQrSlug(qrSlug);
    if (!resolved) {
      return null;
    }
    const { tenantId, locationId, diningTableId } = resolved;
    return withTenant(tenantId, async (trx) => {
      const table = await trx
        .selectFrom("dining_table")
        .select(["label"])
        .where("tenant_id", "=", tenantId)
        .where("id", "=", diningTableId)
        .executeTakeFirst();

      const sessionId = await this.ensureOpenSession(trx, tenantId, locationId, diningTableId);

      const persona = GUEST_PERSONAS[Math.floor(Math.random() * GUEST_PERSONAS.length)] ?? {
        name: "Oaspete",
        emoji: "🍽️",
      };
      const deviceKey = randomBytes(24).toString("base64url");
      const guest = await trx
        .insertInto("session_guest")
        .values({
          tenant_id: tenantId,
          table_session_id: sessionId,
          display_name: persona.name,
          emoji: persona.emoji,
          device_key_hash: sha256(deviceKey),
        })
        .returning("id")
        .executeTakeFirstOrThrow();

      const rawToken = randomBytes(32).toString("base64url");
      await trx
        .insertInto("session_device_token")
        .values({
          tenant_id: tenantId,
          table_session_id: sessionId,
          session_guest_id: guest.id,
          token_hash: sha256(rawToken),
          expires_at: new Date(Date.now() + SESSION_TTL_MS),
        })
        .execute();

      return {
        token: rawToken,
        sessionId,
        tableLabel: table?.label ?? "Masă",
        guest: { displayName: persona.name, emoji: persona.emoji },
      };
    });
  }

  /** Place an order for the resolved session (all items in one transaction). */
  async placeOrder(rawToken: string, body: PlaceOrderRequest): Promise<GuestResult<GuestOrder>> {
    const resolved = await resolveSessionToken(sha256(rawToken));
    if (!resolved) {
      return { ok: false, status: 401, message: "Sesiune expirată sau invalidă." };
    }
    const { tenantId, tableSessionId, sessionGuestId } = resolved;
    return withTenant(tenantId, async (trx) => {
      const session = await trx
        .selectFrom("table_session")
        .select(["location_id"])
        .where("tenant_id", "=", tenantId)
        .where("id", "=", tableSessionId)
        .executeTakeFirst();
      if (!session) {
        return { ok: false as const, status: 401 as const, message: "Sesiune inexistentă." };
      }

      const dishIds = [...new Set(body.items.map((i) => i.dishId))];
      const versions = await trx
        .selectFrom("dish as d")
        .innerJoin("dish_version as v", (join) =>
          join.onRef("v.id", "=", "d.current_version_id").onRef("v.tenant_id", "=", "d.tenant_id"),
        )
        .select([
          "d.id as dish_id",
          "v.id as version_id",
          "v.name",
          "v.price_minor",
          "v.vat_rate_bp",
        ])
        .where("d.tenant_id", "=", tenantId)
        .where("d.archived_at", "is", null)
        .where("d.id", "in", dishIds)
        .execute();
      const byDish = new Map(versions.map((v) => [v.dish_id, v]));

      let subtotal = 0;
      let vatTotal = 0;
      const lines: {
        dishId: string;
        versionId: string;
        name: unknown;
        unit: number;
        vat: number;
        quantity: number;
        lineTotal: number;
        note: string | null;
      }[] = [];
      for (const it of body.items) {
        const v = byDish.get(it.dishId);
        if (!v) {
          return {
            ok: false as const,
            status: 400 as const,
            message: "Un preparat din comandă nu mai este disponibil.",
          };
        }
        const lineTotal = v.price_minor * it.quantity;
        subtotal += lineTotal;
        // VAT embedded in a VAT-inclusive price: price * bp / (10000 + bp).
        vatTotal += Math.round((lineTotal * v.vat_rate_bp) / (10000 + v.vat_rate_bp));
        lines.push({
          dishId: it.dishId,
          versionId: v.version_id,
          name: v.name,
          unit: v.price_minor,
          vat: v.vat_rate_bp,
          quantity: it.quantity,
          lineTotal,
          note: it.note ?? null,
        });
      }

      // is_first_of_session: the first order of a tab needs waiter acceptance.
      const prior = await trx
        .selectFrom("guest_order")
        .select("id")
        .where("tenant_id", "=", tenantId)
        .where("table_session_id", "=", tableSessionId)
        .limit(1)
        .executeTakeFirst();

      const order = await trx
        .insertInto("guest_order")
        .values({
          tenant_id: tenantId,
          location_id: session.location_id,
          table_session_id: tableSessionId,
          status: "submitted",
          is_first_of_session: !prior,
          submitted_by_guest_id: sessionGuestId,
          subtotal_minor: subtotal,
          vat_total_minor: vatTotal,
          total_minor: subtotal,
        })
        .returning(["id", "created_at"])
        .executeTakeFirstOrThrow();

      // Insert items one-by-one so the returned id maps to the right line
      // (multi-row RETURNING order is not guaranteed; orders are small anyway).
      const responseItems: GuestOrder["items"] = [];
      for (const line of lines) {
        const inserted = await trx
          .insertInto("order_item")
          .values({
            tenant_id: tenantId,
            order_id: order.id,
            dish_id: line.dishId,
            dish_version_id: line.versionId,
            session_guest_id: sessionGuestId,
            quantity: line.quantity,
            unit_price_minor: line.unit,
            vat_rate_bp: line.vat,
            line_total_minor: line.lineTotal,
            special_request: line.note,
            status: "submitted",
          })
          .returning("id")
          .executeTakeFirstOrThrow();
        responseItems.push({
          id: inserted.id,
          dishId: line.dishId,
          name: parseBilingual(line.name),
          quantity: line.quantity,
          unitPriceMinor: line.unit,
          lineTotalMinor: line.lineTotal,
          status: "submitted",
          note: line.note,
        });
      }

      // Transactional outbox: relayed to the POS driver by the outbox worker.
      await trx
        .insertInto("outbox_event")
        .values({
          tenant_id: tenantId,
          aggregate_type: "guest_order",
          aggregate_id: order.id,
          event_type: "order.submitted",
          payload: JSON.stringify({ orderId: order.id, totalMinor: subtotal }),
          next_attempt_at: new Date(),
        })
        .execute();

      // Slide the tab's expiry on activity.
      await trx
        .updateTable("table_session")
        .set({ last_activity_at: new Date(), expires_at: new Date(Date.now() + SESSION_TTL_MS) })
        .where("tenant_id", "=", tenantId)
        .where("id", "=", tableSessionId)
        .execute();

      return {
        ok: true as const,
        value: {
          id: order.id,
          status: "submitted" as const,
          subtotalMinor: subtotal,
          totalMinor: subtotal,
          createdAt: order.created_at.toISOString(),
          items: responseItems,
        },
      };
    });
  }

  /** Orders placed in the resolved session (newest first). null = 401. */
  async listOrders(rawToken: string): Promise<GuestOrder[] | null> {
    const resolved = await resolveSessionToken(sha256(rawToken));
    if (!resolved) {
      return null;
    }
    const { tenantId, tableSessionId } = resolved;
    return withTenant(tenantId, async (trx) => {
      const orders = await trx
        .selectFrom("guest_order")
        .select(["id", "status", "subtotal_minor", "total_minor", "created_at"])
        .where("tenant_id", "=", tenantId)
        .where("table_session_id", "=", tableSessionId)
        .orderBy("created_at", "desc")
        .execute();
      if (orders.length === 0) {
        return [];
      }
      const orderIds = orders.map((o) => o.id);
      const items = await trx
        .selectFrom("order_item as oi")
        .innerJoin("dish_version as v", (join) =>
          join.onRef("v.id", "=", "oi.dish_version_id").onRef("v.tenant_id", "=", "oi.tenant_id"),
        )
        .select([
          "oi.id",
          "oi.order_id",
          "oi.dish_id",
          "v.name",
          "oi.quantity",
          "oi.unit_price_minor",
          "oi.line_total_minor",
          "oi.status",
          "oi.special_request",
        ])
        .where("oi.tenant_id", "=", tenantId)
        .where("oi.order_id", "in", orderIds)
        .execute();

      const itemsByOrder = new Map<string, GuestOrder["items"]>();
      for (const it of items) {
        const line = {
          id: it.id,
          dishId: it.dish_id,
          name: parseBilingual(it.name),
          quantity: it.quantity,
          unitPriceMinor: it.unit_price_minor,
          lineTotalMinor: it.line_total_minor,
          status: it.status,
          note: it.special_request,
        };
        const bucket = itemsByOrder.get(it.order_id);
        if (bucket) {
          bucket.push(line);
        } else {
          itemsByOrder.set(it.order_id, [line]);
        }
      }

      return orders.map((o) => ({
        id: o.id,
        status: o.status,
        subtotalMinor: o.subtotal_minor,
        totalMinor: o.total_minor,
        createdAt: o.created_at.toISOString(),
        items: itemsByOrder.get(o.id) ?? [],
      }));
    });
  }

  /** Call a waiter / request the bill. false = 401. */
  async serviceRequest(rawToken: string, kind: ServiceRequestKind): Promise<boolean> {
    const resolved = await resolveSessionToken(sha256(rawToken));
    if (!resolved) {
      return false;
    }
    const { tenantId, tableSessionId, sessionGuestId } = resolved;
    return withTenant(tenantId, async (trx) => {
      const session = await trx
        .selectFrom("table_session")
        .select(["location_id", "dining_table_id"])
        .where("tenant_id", "=", tenantId)
        .where("id", "=", tableSessionId)
        .executeTakeFirst();
      if (!session) {
        return false;
      }
      await trx
        .insertInto("service_request")
        .values({
          tenant_id: tenantId,
          location_id: session.location_id,
          table_session_id: tableSessionId,
          dining_table_id: session.dining_table_id,
          kind,
          status: "open",
          created_by_guest_id: sessionGuestId,
        })
        .execute();
      // service_request is the source of truth; mirror onto the session for the
      // floor view (same tx), per the schema note.
      if (kind === "request_bill") {
        await trx
          .updateTable("table_session")
          .set({ status: "bill_requested", bill_requested_at: new Date() })
          .where("tenant_id", "=", tenantId)
          .where("id", "=", tableSessionId)
          .execute();
      }
      return true;
    });
  }

  /** Find the table's open tab or open a new one (small select-then-insert race
   *  self-heals on retry via uq_open_session_per_table). */
  private async ensureOpenSession(
    trx: TenantTransaction,
    tenantId: string,
    locationId: string,
    diningTableId: string,
  ): Promise<string> {
    const existing = await trx
      .selectFrom("table_session")
      .select(["id"])
      .where("tenant_id", "=", tenantId)
      .where("dining_table_id", "=", diningTableId)
      .where("status", "in", ["open", "bill_requested"])
      .executeTakeFirst();
    if (existing) {
      return existing.id;
    }
    const created = await trx
      .insertInto("table_session")
      .values({
        tenant_id: tenantId,
        location_id: locationId,
        dining_table_id: diningTableId,
        expires_at: new Date(Date.now() + SESSION_TTL_MS),
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    return created.id;
  }
}
