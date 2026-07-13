/**
 * DEV-ONLY seed: tenant "demo" + one location + one tenant_admin user.
 *
 * Why a direct privileged connection: every tenant-scoped table has FORCED
 * row-level security keyed on app.tenant_id, and the tenant table itself only
 * has a USING policy for boca_app — so the app role can never bootstrap the
 * FIRST tenant (chicken-and-egg). The dev compose superuser `boca` (implicit
 * BYPASSRLS) is the sanctioned way in; prod provisioning runs an equivalent
 * script with the migrator login.
 *
 * Usage (dev compose from infra/compose/docker-compose.dev.yml running):
 *   pnpm --filter @boca/api run seed:dev
 * Connection: SEED_DATABASE_URL > DATABASE_URL > dev compose default.
 * Idempotent: re-running resets the demo admin's password/role (dev recovery).
 */
import argon2 from "argon2";
import pg from "pg";

const DEFAULT_DEV_URL = "postgres://boca:boca@127.0.0.1:5432/boca";

function firstRow<T extends pg.QueryResultRow>(result: pg.QueryResult<T>, what: string): T {
  const row = result.rows[0];
  if (!row) {
    throw new Error(`expected a row back from ${what}`);
  }
  return row;
}

const config = {
  connectionString: process.env.SEED_DATABASE_URL ?? process.env.DATABASE_URL ?? DEFAULT_DEV_URL,
  tenantSlug: "demo",
  tenantName: "Demo Restaurant",
  locationName: "Demo Centru",
  adminEmail: process.env.SEED_ADMIN_EMAIL ?? "admin@demo.local",
  adminPassword: process.env.SEED_ADMIN_PASSWORD ?? "demo-Parola1!",
  adminFullName: "Demo Admin",
};

async function main(): Promise<void> {
  if (process.env.NODE_ENV === "production") {
    throw new Error("seed-dev.ts is a dev fixture; refusing to run with NODE_ENV=production");
  }

  const client = new pg.Client({ connectionString: config.connectionString });
  await client.connect();
  try {
    await client.query("begin");

    const tenantResult = await client.query<{ id: string }>(
      `insert into tenant (slug, name) values ($1, $2)
       on conflict (slug) do update set name = excluded.name
       returning id`,
      [config.tenantSlug, config.tenantName],
    );
    const tenantId = firstRow(tenantResult, "tenant upsert").id;

    // location has no natural unique key -> select-then-insert for idempotency.
    const existingLocation = await client.query<{ id: string }>(
      `select id from location
       where tenant_id = $1 and name = $2 and archived_at is null`,
      [tenantId, config.locationName],
    );
    const locationId =
      existingLocation.rows[0]?.id ??
      firstRow(
        await client.query<{ id: string }>(
          `insert into location (tenant_id, name, timezone, address)
           values ($1, $2, 'Europe/Bucharest', 'Strada Demo 1, Bucuresti')
           returning id`,
          [tenantId, config.locationName],
        ),
        "location insert",
      ).id;

    const passwordHash = await argon2.hash(config.adminPassword); // argon2id default
    const userResult = await client.query<{ id: string }>(
      `insert into app_user (tenant_id, location_id, role, email, password_hash, full_name)
       values ($1, $2, 'tenant_admin', $3, $4, $5)
       on conflict (tenant_id, email) do update
         set password_hash = excluded.password_hash,
             role = excluded.role,
             full_name = excluded.full_name,
             is_active = true
       returning id`,
      [tenantId, locationId, config.adminEmail, passwordHash, config.adminFullName],
    );

    await client.query("commit");

    console.log("seed-dev complete:");
    console.log(`  tenant   ${config.tenantSlug}  (${tenantId})`);
    console.log(`  location ${config.locationName}  (${locationId})`);
    console.log(`  admin    ${config.adminEmail}  (${firstRow(userResult, "app_user upsert").id})`);
    console.log("login body:");
    console.log(
      JSON.stringify({
        tenantSlug: config.tenantSlug,
        email: config.adminEmail,
        password: config.adminPassword,
      }),
    );
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error("seed-dev failed:", error);
  process.exitCode = 1;
});
