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

type SeedDish = { ro: string; desc: string; lei: number; signature?: boolean; nonScoreable?: boolean };
type SeedCategory = { ro: string; dishes: SeedDish[] };

const MENU: SeedCategory[] = [
  {
    ro: "Aperitive",
    dishes: [
      { ro: "Mici Euphoria", desc: "Din vită și porc, la grătar, cu muștar de casă.", lei: 8, signature: true },
      { ro: "Cârnați picanți Euphoria", desc: "Afumați în casă, cu ardei iute și usturoi.", lei: 28 },
      { ro: "File de șalău", desc: "Prăjit crocant, cu felie de lămâie.", lei: 42 },
      { ro: "File de păstrăv", desc: "De munte, rumenit la tigaie.", lei: 38 },
    ],
  },
  {
    ro: "Ciorbe & Supe",
    dishes: [
      { ro: "Ciorbă de burtă", desc: "Cu os de vită, smântână și ardei iute, ca la carte.", lei: 26, signature: true },
      { ro: "Ciorbă de fasole cu ciolan afumat", desc: "Legată, cu ceapă călită și tarhon.", lei: 24 },
      { ro: "Supă de pui cu tăieței", desc: "Cu tăieței de casă, întinși cu mâna.", lei: 22 },
      { ro: "Ciorbă de perișoare", desc: "Acrită cu borș, cu leuștean proaspăt.", lei: 24 },
      { ro: "Supă țărănească de vită", desc: "Cu multe legume, gospodărească.", lei: 24 },
    ],
  },
  {
    ro: "Feluri principale",
    dishes: [
      { ro: "Sarmale durdulii cu ciolan", desc: "În foaie de varză murată, cu mămăligă și smântână.", lei: 44, signature: true },
      { ro: "Taci și-nghite", desc: "Mămăligă cu brânză, jumări și ou ochi — vorbește singură.", lei: 38, signature: true },
      { ro: "Ciolan de-ți lasă gura apă", desc: "Copt încet la cuptor, cu varză călită.", lei: 58 },
      { ro: "Șalău „Nu mă uita”", desc: "File cu cartofi noi și fasole verde, cu unt de lămâie.", lei: 62, signature: true },
      { ro: "Papricaș de pui zglobiu", desc: "Cu pulpe de pui și găluște, în sos de boia dulce.", lei: 42 },
      { ro: "Tocăniță ungurească", desc: "De vită, în sos de vin roșu, cu gnocchi.", lei: 54 },
      { ro: "Antricot de vită Limousin", desc: "La grătar, cu unt aromat și legume.", lei: 96 },
      { ro: "Biftec tartar", desc: "Cu măduvă la grătar și pită prăjită.", lei: 68 },
      { ro: "Gulyás de vită Limousin", desc: "Cu găluște și boia, gros și aromat.", lei: 48 },
      { ro: "Pulpă de rață rumenită", desc: "Cu condimente, pe pat de varză roșie.", lei: 64 },
      { ro: "Varză à la Cluj", desc: "Varză murată cu carne tocată de porc, la cuptor.", lei: 40 },
      { ro: "Șnițel de porc", desc: "În crustă crocantă de panko, cu cartofi.", lei: 44 },
    ],
  },
  {
    ro: "Brânzeturi & Garnituri",
    dishes: [
      { ro: "Palaneț cu brânză", desc: "Plăcintă cu brânză și ceapă verde, coaptă pe vatră.", lei: 22 },
      { ro: "Pită picurată", desc: "Cu jumări și brânză, direct din cuptor.", lei: 18 },
      { ro: "Mămăligă la grătar", desc: "Feliată și rumenită pe plită.", lei: 12 },
      { ro: "Hribi trași la tigaie", desc: "Cu usturoi și pătrunjel.", lei: 26 },
      { ro: "Cartofi cu usturoi", desc: "Copți, cu usturoi și verdeață.", lei: 14 },
    ],
  },
  {
    ro: "Salate",
    dishes: [
      { ro: "Salată de boeuf", desc: "Cu mazăre, morcov, vită și maioneză de casă.", lei: 24 },
      { ro: "Salată Euphoria", desc: "Pui, ardei copt și roșii cherry.", lei: 28 },
      { ro: "Salată de ardei copți", desc: "Cu usturoi și ulei de măsline.", lei: 18 },
    ],
  },
  {
    ro: "Deserturi",
    dishes: [
      { ro: "Papanași ropogoși", desc: "Cu smântână și dulceață de afine, calzi.", lei: 26, signature: true },
      { ro: "Somlói galuska", desc: "Pandișpan însiropat, cu nucă și sos de ciocolată.", lei: 24 },
      { ro: "Arsă și delicioasă", desc: "Crème brûlée cu crustă de zahăr caramelizat.", lei: 22, nonScoreable: true },
      { ro: "Tartă cu mere și nuci", desc: "Cu aluat fraged și scorțișoară.", lei: 22 },
    ],
  },
];

function bilingual(ro: string): string {
  // en defaults to the RO string — editable later in the panel.
  return JSON.stringify({ ro, en: ro });
}

async function main(): Promise<void> {
  if (process.env.NODE_ENV === "production") {
    throw new Error("seed-desaga.ts is a dev fixture; refusing to run with NODE_ENV=production");
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
        `insert into app_user (tenant_id, location_id, role, email, password_hash, full_name)
         values ($1, $2, 'tenant_admin', $3, $4, $5)
         on conflict (tenant_id, email) do update
           set password_hash = excluded.password_hash, role = excluded.role,
               full_name = excluded.full_name, is_active = true
         returning id`,
        [tenantId, locationId, config.adminEmail, passwordHash, config.adminFullName],
      )
    ).rows[0]!.id;

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

    const dishCount = await client.query<{ n: string }>(
      `select count(*)::text as n from dish where tenant_id = $1`,
      [tenantId],
    );
    if (Number(dishCount.rows[0]!.n) > 0) {
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
              bilingual(d.ro),
              bilingual(d.desc),
              d.lei * 100,
              VAT_FOOD_BP,
              stationId,
              d.nonScoreable ?? false,
              adminId,
            ],
          )
        ).rows[0]!.id;
        await client.query(`update dish set current_version_id = $1 where id = $2`, [versionId, dishId]);
        dishTotal++;
      }
    }

    await client.query("commit");
    console.log(`seed-desaga complete: tenant ${tenantId}, ${MENU.length} categorii, ${dishTotal} preparate`);
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
    JSON.stringify({ tenantSlug: config.tenantSlug, email: config.adminEmail, password: config.adminPassword }),
  );
}

main().catch((error) => {
  console.error("seed-desaga failed:", error);
  process.exitCode = 1;
});
