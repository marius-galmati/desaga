// Onboard a NEW tenant (brand) on the platform: tenant + location + admin user
// + its public domains. Runs on a PRIVILEGED connection (superuser/migrator or
// boca_platform) because FORCED RLS means boca_app can never create tenants.
//
// Local/test usage:
//   pnpm --filter @boca/api exec tsx scripts/create-tenant.ts \
//     --slug=brandx --name="Restaurant Brand X" \
//     --admin-email=admin@brandx.ro --admin-password="Parola-123!" \
//     --guest-domain=app.brandx.ro \
//     --admin-domain=brandx-admin.platforma.ro \
//     --staff-domain=brandx-staff.platforma.ro
//
// In production (Dokploy, no host SSH) prefer a one-off compose service or the
// future super-admin dashboard — this module is written so the dashboard's
// onboarding endpoint can reuse createTenant() as-is.

import * as argon2 from "argon2";
import pg from "pg";

const DEFAULT_DEV_URL = "postgres://boca:boca@127.0.0.1:55432/boca";

export interface CreateTenantInput {
  slug: string;
  name: string;
  locationName?: string;
  locationAddress?: string | null;
  adminEmail: string;
  adminPassword: string;
  adminFullName?: string;
  /** surface -> hostname; missing surfaces are simply not registered yet. */
  domains: Partial<Record<"guest" | "admin" | "staff", string>>;
}

export interface CreateTenantResult {
  tenantId: string;
  locationId: string;
  adminUserId: string;
  domains: { surface: string; domain: string }[];
}

/**
 * Idempotent tenant onboarding (safe to re-run): upserts the tenant by slug,
 * its first location, the tenant_admin user (password only set on first
 * creation, mirroring seed-desaga), and the surface domains. The caller owns
 * the client + transaction so the future dashboard endpoint can compose it.
 */
export async function createTenant(
  client: pg.Client,
  input: CreateTenantInput,
): Promise<CreateTenantResult> {
  const slug = input.slug.trim().toLowerCase();
  const tenantId = (
    await client.query<{ id: string }>(
      `insert into tenant (slug, name) values ($1, $2)
       on conflict (slug) do update set name = excluded.name returning id`,
      [slug, input.name.trim()],
    )
  ).rows[0]!.id;

  const locationName = input.locationName?.trim() || input.name.trim();
  const existingLoc = await client.query<{ id: string }>(
    `select id from location where tenant_id = $1 and name = $2 and archived_at is null`,
    [tenantId, locationName],
  );
  const locationId =
    existingLoc.rows[0]?.id ??
    (
      await client.query<{ id: string }>(
        `insert into location (tenant_id, name, address) values ($1, $2, $3) returning id`,
        [tenantId, locationName, input.locationAddress ?? null],
      )
    ).rows[0]!.id;

  const passwordHash = await argon2.hash(input.adminPassword);
  const adminUserId = (
    await client.query<{ id: string }>(
      // Password only on first creation — re-running onboarding must never
      // clobber a password the admin later changed in-app.
      `insert into app_user (tenant_id, location_id, role, email, password_hash, full_name)
       values ($1, $2, 'tenant_admin', $3, $4, $5)
       on conflict (tenant_id, email) do update
         set role = excluded.role, full_name = excluded.full_name, is_active = true
       returning id`,
      [
        tenantId,
        locationId,
        input.adminEmail.trim().toLowerCase(),
        passwordHash,
        input.adminFullName?.trim() || `Administrator ${input.name.trim()}`,
      ],
    )
  ).rows[0]!.id;

  const domains: CreateTenantResult["domains"] = [];
  for (const surface of ["guest", "admin", "staff"] as const) {
    const raw = input.domains[surface];
    const domain = raw?.trim().toLowerCase();
    if (!domain) continue;
    await client.query(
      `insert into tenant_domain (tenant_id, domain, surface)
       values ($1, $2, $3)
       on conflict (domain) do update set tenant_id = excluded.tenant_id,
                                          surface   = excluded.surface`,
      [tenantId, domain, surface],
    );
    domains.push({ surface, domain });
  }

  return { tenantId, locationId, adminUserId, domains };
}

// ---------------------------------------------------------------------------
// CLI entry
// ---------------------------------------------------------------------------

function argValue(name: string): string | undefined {
  const prefix = `--${name}=`;
  const hit = process.argv.find((a) => a.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : undefined;
}

async function main(): Promise<void> {
  const slug = argValue("slug");
  const name = argValue("name");
  const adminEmail = argValue("admin-email");
  const adminPassword = argValue("admin-password");
  if (!slug || !name || !adminEmail || !adminPassword) {
    console.error(
      "usage: tsx scripts/create-tenant.ts --slug=x --name=... --admin-email=... --admin-password=... " +
        "[--location-name=...] [--location-address=...] " +
        "[--guest-domain=...] [--admin-domain=...] [--staff-domain=...]",
    );
    process.exit(1);
  }
  if (process.env.NODE_ENV === "production" && process.env.ALLOW_PROD_SEED !== "true") {
    throw new Error("refusing to run with NODE_ENV=production; set ALLOW_PROD_SEED=true");
  }

  const locationName = argValue("location-name");
  const locationAddress = argValue("location-address");
  const guestDomain = argValue("guest-domain");
  const adminDomain = argValue("admin-domain");
  const staffDomain = argValue("staff-domain");

  const client = new pg.Client({
    connectionString: process.env.SEED_DATABASE_URL ?? process.env.DATABASE_URL ?? DEFAULT_DEV_URL,
  });
  await client.connect();
  try {
    await client.query("begin");
    const result = await createTenant(client, {
      slug,
      name,
      adminEmail,
      adminPassword,
      ...(locationName ? { locationName } : {}),
      ...(locationAddress ? { locationAddress } : {}),
      domains: {
        ...(guestDomain ? { guest: guestDomain } : {}),
        ...(adminDomain ? { admin: adminDomain } : {}),
        ...(staffDomain ? { staff: staffDomain } : {}),
      },
    });
    await client.query("commit");
    console.log(`==> tenant '${slug}' ready`);
    console.log(`    tenant_id: ${result.tenantId}`);
    console.log(`    admin:     ${adminEmail}`);
    for (const d of result.domains) {
      console.log(`    ${d.surface.padEnd(6)} https://${d.domain}`);
    }
  } catch (err) {
    await client.query("rollback").catch(() => {});
    throw err;
  } finally {
    await client.end();
  }
}

// Only run the CLI when invoked directly (the dashboard imports createTenant).
if (process.argv[1]?.replace(/\\/g, "/").endsWith("create-tenant.ts")) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
