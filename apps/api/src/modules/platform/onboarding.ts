// Tenant onboarding core — shared by the CLI (scripts/create-tenant.ts) and the
// platform dashboard endpoint. Must run on a PRIVILEGED connection (superuser
// or boca_platform): FORCED RLS means boca_app can never create tenants.

import * as argon2 from "argon2";
import type pg from "pg";

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
 * the client + transaction.
 */
export async function createTenant(
  client: pg.ClientBase,
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
