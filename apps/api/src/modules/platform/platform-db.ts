// Dedicated pg pool for the platform (super-admin) surface, connecting as
// boca_platform_login — the ONLY role that can create tenants (FORCED RLS keeps
// boca_app out by design). Deliberately NOT part of @boca/db: that package's
// invariant is "no tenant query without SET LOCAL app.tenant_id", and platform
// operations are the sanctioned cross-tenant exception, kept in raw SQL here.

import pg from "pg";
import { getEnv } from "../../config/env";

let pool: pg.Pool | null = null;

/** True when the deployment opted into the platform dashboard. */
export function platformDbConfigured(): boolean {
  return Boolean(getEnv().PLATFORM_DATABASE_URL);
}

export function getPlatformPool(): pg.Pool {
  const url = getEnv().PLATFORM_DATABASE_URL;
  if (!url) {
    throw new Error("PLATFORM_DATABASE_URL is not configured");
  }
  if (!pool) {
    pool = new pg.Pool({ connectionString: url, max: 3 });
  }
  return pool;
}

export async function destroyPlatformPool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
