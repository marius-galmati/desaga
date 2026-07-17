// CLI wrapper around the shared tenant-onboarding core
// (src/modules/platform/onboarding.ts — also used by the platform dashboard).
// Runs on a PRIVILEGED connection (superuser/migrator or boca_platform).
//
// Local/test usage:
//   pnpm --filter @boca/api exec tsx scripts/create-tenant.ts \
//     --slug=brandx --name="Restaurant Brand X" \
//     --admin-email=admin@brandx.ro --admin-password="Parola-123!" \
//     --guest-domain=app.brandx.ro \
//     --admin-domain=brandx-admin.platforma.ro \
//     --staff-domain=brandx-staff.platforma.ro
//
// In production prefer the super-admin dashboard (apps/platform).

import pg from "pg";
import { createTenant } from "../src/modules/platform/onboarding";

const DEFAULT_DEV_URL = "postgres://boca:boca@127.0.0.1:55432/boca";

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

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
