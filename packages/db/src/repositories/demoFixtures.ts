// Standing demo fixtures for the owner-facing AI evaluation demo. The real
// schema chain requires a full service context (menu_category, station,
// capture_device, floor_section -> dining_table -> table_session) before a
// synthetic guest_order/order_item can anchor a pass_photo. All helpers are
// idempotent get-or-create keyed on natural demo names, so re-running the demo
// flow reuses the same standing rows.

import { sql } from "kysely";
import type { TenantTransaction } from "../tenant";

export const DEMO_STATION_CODE = "demo_ai";
export const DEMO_CAPTURE_PROFILE_VERSION = "demo-manual-v1";

const DEMO_CATEGORY_NAME = { ro: "Demo AI", en: "AI Demo" };
const DEMO_STATION_NAME = { ro: "Stație demo AI", en: "AI demo station" };
const DEMO_DEVICE_NAME = "Demo capture device";
const DEMO_SECTION_NAME = "Demo AI";
const DEMO_TABLE_LABEL = "AI-DEMO";
// Synthetic session for demo orders only; far-future expiry keeps the sliding
// expiry sweeper away from it. Re-created automatically if closed/expired.
const DEMO_SESSION_EXPIRES_AT = new Date("2126-01-01T00:00:00.000Z");

export interface DemoFixtureIds {
  menuCategoryId: string;
  stationId: string;
  captureDeviceId: string;
  floorSectionId: string;
  diningTableId: string;
  tableSessionId: string;
}

async function ensureDemoMenuCategory(trx: TenantTransaction, tenantId: string): Promise<string> {
  const existing = await trx
    .selectFrom("menu_category")
    .select(["id"])
    .where(sql<string>`name->>'ro'`, "=", DEMO_CATEGORY_NAME.ro)
    .where("archived_at", "is", null)
    .executeTakeFirst();
  if (existing) {
    return existing.id;
  }
  const inserted = await trx
    .insertInto("menu_category")
    .values({ tenant_id: tenantId, name: JSON.stringify(DEMO_CATEGORY_NAME) })
    .returning("id")
    .executeTakeFirstOrThrow();
  return inserted.id;
}

async function ensureDemoStation(trx: TenantTransaction, tenantId: string): Promise<string> {
  const existing = await trx
    .selectFrom("station")
    .select(["id"])
    .where("code", "=", DEMO_STATION_CODE)
    .executeTakeFirst();
  if (existing) {
    return existing.id;
  }
  const inserted = await trx
    .insertInto("station")
    .values({
      tenant_id: tenantId,
      code: DEMO_STATION_CODE,
      name: JSON.stringify(DEMO_STATION_NAME),
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  return inserted.id;
}

async function ensureDemoCaptureDevice(
  trx: TenantTransaction,
  tenantId: string,
  locationId: string,
): Promise<string> {
  const existing = await trx
    .selectFrom("capture_device")
    .select(["id"])
    .where("location_id", "=", locationId)
    .where("name", "=", DEMO_DEVICE_NAME)
    .executeTakeFirst();
  if (existing) {
    return existing.id;
  }
  const inserted = await trx
    .insertInto("capture_device")
    .values({
      tenant_id: tenantId,
      location_id: locationId,
      name: DEMO_DEVICE_NAME,
      platform: "demo",
      capture_profile_version: DEMO_CAPTURE_PROFILE_VERSION,
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  return inserted.id;
}

async function ensureDemoFloorSection(
  trx: TenantTransaction,
  tenantId: string,
  locationId: string,
): Promise<string> {
  const existing = await trx
    .selectFrom("floor_section")
    .select(["id"])
    .where("location_id", "=", locationId)
    .where("name", "=", DEMO_SECTION_NAME)
    .where("archived_at", "is", null)
    .executeTakeFirst();
  if (existing) {
    return existing.id;
  }
  const inserted = await trx
    .insertInto("floor_section")
    .values({ tenant_id: tenantId, location_id: locationId, name: DEMO_SECTION_NAME })
    .returning("id")
    .executeTakeFirstOrThrow();
  return inserted.id;
}

async function ensureDemoDiningTable(
  trx: TenantTransaction,
  tenantId: string,
  locationId: string,
  floorSectionId: string,
): Promise<string> {
  const existing = await trx
    .selectFrom("dining_table")
    .select(["id"])
    .where("location_id", "=", locationId)
    .where("label", "=", DEMO_TABLE_LABEL)
    .executeTakeFirst();
  if (existing) {
    return existing.id;
  }
  const inserted = await trx
    .insertInto("dining_table")
    .values({
      tenant_id: tenantId,
      location_id: locationId,
      floor_section_id: floorSectionId,
      label: DEMO_TABLE_LABEL,
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  return inserted.id;
}

async function ensureDemoTableSession(
  trx: TenantTransaction,
  tenantId: string,
  locationId: string,
  diningTableId: string,
): Promise<string> {
  // uq_open_session_per_table guarantees at most one open session per table.
  const existing = await trx
    .selectFrom("table_session")
    .select(["id"])
    .where("dining_table_id", "=", diningTableId)
    .where("status", "in", ["open", "bill_requested"])
    .executeTakeFirst();
  if (existing) {
    return existing.id;
  }
  const inserted = await trx
    .insertInto("table_session")
    .values({
      tenant_id: tenantId,
      location_id: locationId,
      dining_table_id: diningTableId,
      expires_at: DEMO_SESSION_EXPIRES_AT,
    })
    .returning("id")
    .executeTakeFirstOrThrow();
  return inserted.id;
}

/**
 * Get-or-create every standing row the synthetic evaluation chain needs.
 * Call once per demo request inside the same withTenant tx as the chain.
 */
export async function ensureDemoFixtures(
  trx: TenantTransaction,
  params: { tenantId: string; locationId: string },
): Promise<DemoFixtureIds> {
  const { tenantId, locationId } = params;
  const menuCategoryId = await ensureDemoMenuCategory(trx, tenantId);
  const stationId = await ensureDemoStation(trx, tenantId);
  const captureDeviceId = await ensureDemoCaptureDevice(trx, tenantId, locationId);
  const floorSectionId = await ensureDemoFloorSection(trx, tenantId, locationId);
  const diningTableId = await ensureDemoDiningTable(trx, tenantId, locationId, floorSectionId);
  const tableSessionId = await ensureDemoTableSession(trx, tenantId, locationId, diningTableId);
  return {
    menuCategoryId,
    stationId,
    captureDeviceId,
    floorSectionId,
    diningTableId,
    tableSessionId,
  };
}
