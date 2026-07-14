import type { AdminOrder } from "@boca/contracts";
import { withTenant } from "@boca/db";
import { Injectable } from "@nestjs/common";
import type { Principal } from "../../common/principal";
import type { ServiceResult } from "../evaluation/evaluation.service";
import { parseBilingual } from "./admin.helpers";

// Orders still on the floor: placed but not yet served/voided.
const ACTIVE_STATUSES = ["submitted", "accepted"] as const;

@Injectable()
export class OrderService {
  /** Active guest orders across the tenant's floor, oldest first (FIFO). */
  async listOrders(principal: Principal): Promise<AdminOrder[]> {
    return withTenant(principal.tenantId, async (trx) => {
      const orders = await trx
        .selectFrom("guest_order as go")
        .innerJoin("table_session as ts", (join) =>
          join
            .onRef("ts.id", "=", "go.table_session_id")
            .onRef("ts.tenant_id", "=", "go.tenant_id"),
        )
        .innerJoin("dining_table as dt", (join) =>
          join.onRef("dt.id", "=", "ts.dining_table_id").onRef("dt.tenant_id", "=", "ts.tenant_id"),
        )
        .leftJoin("session_guest as sg", (join) =>
          join
            .onRef("sg.id", "=", "go.submitted_by_guest_id")
            .onRef("sg.tenant_id", "=", "go.tenant_id"),
        )
        .select([
          "go.id",
          "go.status",
          "go.is_first_of_session",
          "go.subtotal_minor",
          "go.total_minor",
          "go.created_at",
          "dt.label as table_label",
          "sg.display_name",
          "sg.emoji",
        ])
        .where("go.tenant_id", "=", principal.tenantId)
        .where("go.status", "in", ACTIVE_STATUSES)
        .orderBy("go.created_at")
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
          "v.name",
          "oi.quantity",
          "oi.line_total_minor",
          "oi.status",
          "oi.special_request",
        ])
        .where("oi.tenant_id", "=", principal.tenantId)
        .where("oi.order_id", "in", orderIds)
        .execute();

      const itemsByOrder = new Map<string, AdminOrder["items"]>();
      for (const it of items) {
        const line = {
          id: it.id,
          dishName: parseBilingual(it.name),
          quantity: it.quantity,
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
        tableLabel: o.table_label,
        status: o.status,
        isFirstOfSession: o.is_first_of_session,
        guest: o.display_name ? { displayName: o.display_name, emoji: o.emoji ?? "🍽️" } : null,
        subtotalMinor: o.subtotal_minor,
        totalMinor: o.total_minor,
        createdAt: o.created_at.toISOString(),
        items: itemsByOrder.get(o.id) ?? [],
      }));
    });
  }

  /** Waiter accepts a submitted order (submitted -> accepted). */
  async acceptOrder(principal: Principal, id: string): Promise<ServiceResult<{ ok: true }>> {
    return withTenant(principal.tenantId, async (trx) => {
      const updated = await trx
        .updateTable("guest_order")
        .set({ status: "accepted", accepted_by: principal.userId, accepted_at: new Date() })
        .where("tenant_id", "=", principal.tenantId)
        .where("id", "=", id)
        .where("status", "=", "submitted")
        .executeTakeFirst();
      if (updated.numUpdatedRows === 0n) {
        return {
          ok: false as const,
          status: 409 as const,
          message: "order not in a submitted state",
        };
      }
      return { ok: true as const, value: { ok: true as const } };
    });
  }

  /** Mark an order served: order + all its non-voided items -> served. */
  async serveOrder(principal: Principal, id: string): Promise<ServiceResult<{ ok: true }>> {
    return withTenant(principal.tenantId, async (trx) => {
      const now = new Date();
      const updated = await trx
        .updateTable("guest_order")
        .set({ status: "served", updated_at: now })
        .where("tenant_id", "=", principal.tenantId)
        .where("id", "=", id)
        .where("status", "in", ["submitted", "accepted"])
        .executeTakeFirst();
      if (updated.numUpdatedRows === 0n) {
        return {
          ok: false as const,
          status: 409 as const,
          message: "order not in a servable state",
        };
      }
      await trx
        .updateTable("order_item")
        .set({ status: "served", served_at: now, updated_at: now })
        .where("tenant_id", "=", principal.tenantId)
        .where("order_id", "=", id)
        .where("status", "!=", "voided")
        .execute();
      return { ok: true as const, value: { ok: true as const } };
    });
  }
}
