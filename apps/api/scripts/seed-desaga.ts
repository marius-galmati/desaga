/**
 * Real-tenant seed: "Desaga" tenant + location + a kitchen station + a capture
 * device + the real menu (categories & dishes) + a tenant_admin login.
 *
 * This is the starting content for the FUNCTIONAL admin panel — you log in and
 * your dishes are already there; you just add photos, reference sets and
 * tolerances. Uses the same privileged-connection rationale as seed-dev.ts
 * (FORCED RLS means the app role can't bootstrap the first tenant).
 *
 * Usage (dev compose up):  pnpm --filter @boca/api run seed:desaga
 * Idempotent: re-running upserts tenant/location/admin/station/device and only
 * inserts the menu when the tenant has no dishes yet.
 *
 * Prices are plausible starters in RON (bani) — edit them in the panel.
 */
import argon2 from "argon2";
import pg from "pg";
import menuData from "./desaga-menu.json";

const DEFAULT_DEV_URL = "postgres://boca:boca@127.0.0.1:55432/boca";
const VAT_FOOD_BP = 900; // Romanian restaurant food VAT ~9% (edit per accountant)

const config = {
  connectionString: process.env.SEED_DATABASE_URL ?? process.env.DATABASE_URL ?? DEFAULT_DEV_URL,
  tenantSlug: "desaga",
  tenantName: "Restaurantele Desaga by Euphoria",
  locationName: "Desaga Cluj-Napoca",
  locationAddress: "Bd. 1 Decembrie 1918, nr. 110, Cluj-Napoca",
  adminEmail: process.env.SEED_ADMIN_EMAIL ?? "admin@desaga.ro",
  adminPassword: process.env.SEED_ADMIN_PASSWORD ?? "Desaga-2026!",
  adminFullName: "Administrator Desaga",
};

type SeedDish = {
  ro: string;
  en?: string | null;
  descRo?: string | null;
  descEn?: string | null;
  lei: number;
  nonScoreable?: boolean;
};
type SeedCategory = { ro: string; dishes: SeedDish[] };

// The real Desaga menu, transcribed 1:1 from the official PDF menu
// (apps/api/scripts/desaga-menu.json - 61 categories, 467 items, food + drinks).
// Regenerate that JSON from the PDF if the printed menu changes.
const MENU = menuData as unknown as SeedCategory[];

function bilingual(ro: string): string {
  // en defaults to the RO string — editable later in the panel.
  return JSON.stringify({ ro, en: ro });
}

// Name with a distinct English translation when the menu prints one.
function bi(ro: string, en?: string | null): string {
  return JSON.stringify({ ro, en: en && en.trim() ? en.trim() : ro });
}

// Description: nullable jsonb — null when the item has no description.
function biOrNull(ro?: string | null, en?: string | null): string | null {
  if (!ro || !ro.trim()) return null;
  return JSON.stringify({ ro: ro.trim(), en: en && en.trim() ? en.trim() : ro.trim() });
}

async function main(): Promise<void> {
  // This seeds the REAL Desaga tenant, so it IS the intended production bootstrap
  // — but require an explicit opt-in so it can't run by accident. The prod
  // `seed` compose service sets ALLOW_PROD_SEED=true.
  if (process.env.NODE_ENV === "production" && process.env.ALLOW_PROD_SEED !== "true") {
    throw new Error(
      "refusing to seed with NODE_ENV=production; set ALLOW_PROD_SEED=true to bootstrap prod",
    );
  }
  const client = new pg.Client({ connectionString: config.connectionString });
  await client.connect();
  try {
    await client.query("begin");

    const tenantId = (
      await client.query<{ id: string }>(
        `insert into tenant (slug, name) values ($1, $2)
         on conflict (slug) do update set name = excluded.name returning id`,
        [config.tenantSlug, config.tenantName],
      )
    ).rows[0]!.id;

    // Multi-domain backfill: register this deployment's public hostnames so
    // Host-based tenant resolution covers the seeded tenant. Compose passes
    // the live *_HOST values; absent env (local dev) skips the row.
    const domainSeeds: { domain: string | undefined; surface: string }[] = [
      { domain: process.env.SEED_GUEST_DOMAIN, surface: "guest" },
      { domain: process.env.SEED_ADMIN_DOMAIN, surface: "admin" },
      { domain: process.env.SEED_STAFF_DOMAIN, surface: "staff" },
    ];
    for (const { domain, surface } of domainSeeds) {
      const host = domain?.trim().toLowerCase();
      if (!host) continue;
      await client.query(
        `insert into tenant_domain (tenant_id, domain, surface)
         values ($1, $2, $3)
         on conflict (domain) do update set tenant_id = excluded.tenant_id,
                                            surface   = excluded.surface`,
        [tenantId, host, surface],
      );
    }

    // First platform (super-admin) account for the dashboard — only when the
    // operator opted in via env. Password applies on first creation only.
    const platformEmail = process.env.PLATFORM_ADMIN_EMAIL?.trim();
    const platformPassword = process.env.PLATFORM_ADMIN_PASSWORD;
    if (platformEmail && platformPassword) {
      const platformHash = await argon2.hash(platformPassword);
      await client.query(
        `insert into platform_admin (email, password_hash, full_name)
         values ($1, $2, $3)
         on conflict (email) do update set is_active = true`,
        [platformEmail, platformHash, "Operator platformă"],
      );
    }

    // Brand identity — FIRST RUN ONLY (never clobber what the admin edited
    // in-app). Colors stay empty: the CSS defaults already ARE Desaga.
    await client.query(
      `insert into tenant_branding (tenant_id, display_name, tagline, greeting, promise, locations)
       values ($1, $2, $3, $4, $5, $6)
       on conflict (tenant_id) do nothing`,
      [
        tenantId,
        config.tenantName,
        "Gust Autentic",
        "No, zîua bună!",
        "Peste 100 de preparate tradiționale din bucătăria românească și maghiară",
        ["Cluj-Napoca", "Topa Mică"],
      ],
    );

    // Quality settings — FIRST RUN ONLY (admin-owned knob afterwards).
    // Desaga scores against a SINGLE reference photo per dish (REF1).
    await client.query(
      `insert into tenant_settings (tenant_id, reference_photo_count)
       values ($1, $2)
       on conflict (tenant_id) do nothing`,
      [tenantId, 1],
    );

    const existingLoc = await client.query<{ id: string }>(
      `select id from location where tenant_id = $1 and name = $2 and archived_at is null`,
      [tenantId, config.locationName],
    );
    const locationId =
      existingLoc.rows[0]?.id ??
      (
        await client.query<{ id: string }>(
          `insert into location (tenant_id, name, address) values ($1, $2, $3) returning id`,
          [tenantId, config.locationName, config.locationAddress],
        )
      ).rows[0]!.id;

    const passwordHash = await argon2.hash(config.adminPassword);
    const adminId = (
      await client.query<{ id: string }>(
        // Password is set ONLY on first creation. On conflict we deliberately do
        // NOT touch password_hash: this seed runs on every deploy, and clobbering
        // the hash would reset a password the admin later changed in-app.
        `insert into app_user (tenant_id, location_id, role, email, password_hash, full_name)
         values ($1, $2, 'tenant_admin', $3, $4, $5)
         on conflict (tenant_id, email) do update
           set role = excluded.role, full_name = excluded.full_name, is_active = true
         returning id`,
        [tenantId, locationId, config.adminEmail, passwordHash, config.adminFullName],
      )
    ).rows[0]!.id;

    // A kitchen_pass user for the staff plating-capture app. Same non-clobber
    // policy; password defaults to the admin password unless SEED_STAFF_PASSWORD
    // is set.
    const staffPasswordHash = await argon2.hash(
      process.env.SEED_STAFF_PASSWORD ?? config.adminPassword,
    );
    await client.query(
      `insert into app_user (tenant_id, location_id, role, email, password_hash, full_name)
       values ($1, $2, 'kitchen_pass', $3, $4, $5)
       on conflict (tenant_id, email) do update
         set role = excluded.role, full_name = excluded.full_name, is_active = true`,
      [tenantId, locationId, "pass@desaga.ro", staffPasswordHash, "Bucătar la pass"],
    );

    // A single kitchen station (dish_version.station_id is NOT NULL).
    const stationId = (
      await client.query<{ id: string }>(
        `insert into station (tenant_id, code, name) values ($1, 'principal', $2)
         on conflict (tenant_id, code) do update set name = excluded.name returning id`,
        [tenantId, bilingual("Bucătărie principală")],
      )
    ).rows[0]!.id;

    // A capture device so reference photos can be attributed (NOT NULL FK).
    const existingDevice = await client.query<{ id: string }>(
      `select id from capture_device where tenant_id = $1 and location_id = $2 and name = $3`,
      [tenantId, locationId, "Pass Android — Desaga Cluj"],
    );
    if (existingDevice.rows.length === 0) {
      await client.query(
        `insert into capture_device (tenant_id, location_id, name, platform, capture_profile_version)
         values ($1, $2, 'Pass Android — Desaga Cluj', 'android', 'v1')`,
        [tenantId, locationId],
      );
    }

    // Dining tables + QR slugs for the guest ordering app. Idempotent: only
    // seeded when the tenant has no tables yet. Slugs are readable on purpose
    // (demo convenience) — real deployments mint unguessable ones.
    const tableCount = await client.query<{ n: string }>(
      `select count(*)::text as n from dining_table where tenant_id = $1`,
      [tenantId],
    );
    if (Number(tableCount.rows[0]!.n) === 0) {
      const sectionId = (
        await client.query<{ id: string }>(
          `insert into floor_section (tenant_id, location_id, name) values ($1, $2, $3) returning id`,
          [tenantId, locationId, "Sală principală"],
        )
      ).rows[0]!.id;
      for (let i = 1; i <= 8; i++) {
        const label = `Masa ${i}`;
        const diningTableId = (
          await client.query<{ id: string }>(
            `insert into dining_table (tenant_id, location_id, floor_section_id, label, seats)
             values ($1, $2, $3, $4, $5) returning id`,
            [tenantId, locationId, sectionId, label, i <= 4 ? 2 : 4],
          )
        ).rows[0]!.id;
        await client.query(
          `insert into table_qr_slug (tenant_id, dining_table_id, slug) values ($1, $2, $3)`,
          [tenantId, diningTableId, `desaga-masa-${i}`],
        );
      }
      console.log("seeded 8 dining tables + QR slugs (desaga-masa-1 .. desaga-masa-8)");
    }

    const dishCount = await client.query<{ n: string }>(
      `select count(*)::text as n from dish where tenant_id = $1`,
      [tenantId],
    );
    // RESEED_MENU=true replaces the whole menu: archive the current categories +
    // dishes (soft, so existing orders/references stay valid) and insert the new
    // menu below. Set it once, redeploy, then REMOVE it (else every deploy
    // re-archives and re-inserts a fresh copy).
    if (process.env.RESEED_MENU === "true") {
      await client.query(
        `update dish set archived_at = now() where tenant_id = $1 and archived_at is null`,
        [tenantId],
      );
      await client.query(
        `update menu_category set archived_at = now() where tenant_id = $1 and archived_at is null`,
        [tenantId],
      );
      console.log("RESEED_MENU=true: archived the existing menu; inserting the new one.");
    } else if (Number(dishCount.rows[0]!.n) > 0) {
      await client.query("commit");
      console.log(`Desaga already has dishes — skipped menu insert. tenant ${tenantId}`);
      printLogin();
      return;
    }

    let catOrder = 0;
    let dishTotal = 0;
    for (const cat of MENU) {
      const categoryId = (
        await client.query<{ id: string }>(
          `insert into menu_category (tenant_id, name, sort_order) values ($1, $2, $3) returning id`,
          [tenantId, bilingual(cat.ro), catOrder++],
        )
      ).rows[0]!.id;

      for (const d of cat.dishes) {
        const dishId = (
          await client.query<{ id: string }>(
            `insert into dish (tenant_id, menu_category_id, refs_stale) values ($1, $2, true) returning id`,
            [tenantId, categoryId],
          )
        ).rows[0]!.id;
        const versionId = (
          await client.query<{ id: string }>(
            `insert into dish_version
               (tenant_id, dish_id, version_no, name, description, price_minor, vat_rate_bp,
                station_id, non_scoreable, created_by)
             values ($1, $2, 1, $3, $4, $5, $6, $7, $8, $9) returning id`,
            [
              tenantId,
              dishId,
              bi(d.ro, d.en),
              biOrNull(d.descRo, d.descEn),
              Math.round(d.lei * 100),
              VAT_FOOD_BP,
              stationId,
              d.nonScoreable ?? false,
              adminId,
            ],
          )
        ).rows[0]!.id;
        await client.query(`update dish set current_version_id = $1 where id = $2`, [
          versionId,
          dishId,
        ]);
        dishTotal++;
      }
    }

    await client.query("commit");
    console.log(
      `seed-desaga complete: tenant ${tenantId}, ${MENU.length} categorii, ${dishTotal} preparate`,
    );
    printLogin();
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    await client.end();
  }
}

function printLogin(): void {
  console.log("login:");
  console.log(
    JSON.stringify({
      tenantSlug: config.tenantSlug,
      email: config.adminEmail,
      password: config.adminPassword,
    }),
  );
}

main().catch((error) => {
  console.error("seed-desaga failed:", error);
  process.exitCode = 1;
});
