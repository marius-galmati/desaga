import {
  type AddPlatformDomainRequest,
  brandColorsSchema,
  type CreatePlatformTenantRequest,
  type PlatformBranding,
  type PlatformLoginResponse,
  type PlatformTenant,
  type UpdatePlatformBrandingRequest,
} from "@boca/contracts";
import { Injectable, Logger } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import * as argon2 from "argon2";
import { createTenant } from "./onboarding";
import { getPlatformPool, platformDbConfigured } from "./platform-db";

const PLATFORM_TOKEN_TTL_SECONDS = 8 * 60 * 60; // ops tool: re-login daily

export type PlatformResult<T> =
  | { ok: true; value: T }
  | { ok: false; status: 400 | 401 | 404 | 409 | 503; message: string };

const NOT_CONFIGURED: PlatformResult<never> = {
  ok: false,
  status: 503,
  message:
    "Dashboard-ul de platformă nu e activat: setează PLATFORM_DB_PASSWORD (și redeploy) mai întâi.",
};

@Injectable()
export class PlatformService {
  private readonly logger = new Logger(PlatformService.name);

  constructor(private readonly jwt: JwtService) {}

  async login(email: string, password: string): Promise<PlatformResult<PlatformLoginResponse>> {
    if (!platformDbConfigured()) return NOT_CONFIGURED;
    const pool = getPlatformPool();
    const res = await pool.query<{
      id: string;
      email: string;
      password_hash: string;
      full_name: string;
    }>(
      `select id, email, password_hash, full_name
       from platform_admin
       where email = $1::citext and is_active`,
      [email.trim()],
    );
    const admin = res.rows[0];
    if (!admin) {
      await argon2.hash(password); // burn comparable time (user enumeration)
      return { ok: false, status: 401, message: "Date de autentificare greșite." };
    }
    const passwordOk = await argon2.verify(admin.password_hash, password);
    if (!passwordOk) {
      return { ok: false, status: 401, message: "Date de autentificare greșite." };
    }
    const token = await this.jwt.signAsync(
      { sub: admin.id, typ: "platform" },
      { expiresIn: PLATFORM_TOKEN_TTL_SECONDS },
    );
    return {
      ok: true,
      value: {
        token,
        expiresInSeconds: PLATFORM_TOKEN_TTL_SECONDS,
        admin: { id: admin.id, email: admin.email, fullName: admin.full_name },
      },
    };
  }

  async listTenants(): Promise<PlatformResult<PlatformTenant[]>> {
    if (!platformDbConfigured()) return NOT_CONFIGURED;
    const pool = getPlatformPool();
    const [tenants, domains, brandings] = await Promise.all([
      pool.query<{
        id: string;
        slug: string;
        name: string;
        created_at: Date;
        archived_at: Date | null;
      }>(`select id, slug, name, created_at, archived_at from tenant order by created_at`),
      pool.query<{
        id: string;
        tenant_id: string;
        domain: string;
        surface: string;
        is_primary: boolean;
      }>(`select id, tenant_id, domain, surface, is_primary from tenant_domain order by domain`),
      pool.query<{
        tenant_id: string;
        display_name: string | null;
        tagline: string | null;
        greeting: string | null;
        promise: string | null;
        locations: string[] | null;
        logo_media_id: string | null;
        palette: unknown;
      }>(`select tenant_id, display_name, tagline, greeting, promise, locations,
                 logo_media_id, palette
          from tenant_branding`),
    ]);

    const domainsByTenant = new Map<string, PlatformTenant["domains"]>();
    for (const d of domains.rows) {
      const surface: "guest" | "admin" | "staff" =
        d.surface === "admin" || d.surface === "staff" ? d.surface : "guest";
      const entry = { id: d.id, domain: d.domain, surface, isPrimary: d.is_primary };
      const bucket = domainsByTenant.get(d.tenant_id);
      if (bucket) bucket.push(entry);
      else domainsByTenant.set(d.tenant_id, [entry]);
    }

    const brandingByTenant = new Map<string, PlatformBranding>();
    for (const b of brandings.rows) {
      const colors = brandColorsSchema.safeParse(b.palette);
      brandingByTenant.set(b.tenant_id, {
        displayName: b.display_name,
        tagline: b.tagline,
        greeting: b.greeting,
        promise: b.promise,
        locations: b.locations ?? [],
        hasLogo: b.logo_media_id !== null,
        colors: colors.success ? colors.data : {},
      });
    }

    return {
      ok: true,
      value: tenants.rows.map((t) => ({
        id: t.id,
        slug: t.slug,
        name: t.name,
        createdAt: t.created_at.toISOString(),
        archivedAt: t.archived_at ? t.archived_at.toISOString() : null,
        domains: domainsByTenant.get(t.id) ?? [],
        branding: brandingByTenant.get(t.id) ?? null,
      })),
    };
  }

  async createTenant(
    body: CreatePlatformTenantRequest,
  ): Promise<PlatformResult<{ tenantId: string }>> {
    if (!platformDbConfigured()) return NOT_CONFIGURED;
    // Refuse to silently ADOPT an existing tenant (the CLI upsert is for
    // re-runs; from the dashboard a duplicate slug is almost surely a typo).
    const pool = getPlatformPool();
    const existing = await pool.query(`select 1 from tenant where slug = $1::citext`, [body.slug]);
    if ((existing.rowCount ?? 0) > 0) {
      return {
        ok: false,
        status: 409,
        message: "Există deja un restaurant cu acest identificator.",
      };
    }
    for (const domain of Object.values(body.domains)) {
      if (!domain) continue;
      const taken = await pool.query(`select 1 from tenant_domain where domain = $1::citext`, [
        domain,
      ]);
      if ((taken.rowCount ?? 0) > 0) {
        return { ok: false, status: 409, message: `Domeniul ${domain} e deja folosit.` };
      }
    }

    const domains: Partial<Record<"guest" | "admin" | "staff", string>> = {};
    for (const surface of ["guest", "admin", "staff"] as const) {
      const d = body.domains[surface];
      if (d) domains[surface] = d;
    }

    const client = await pool.connect();
    try {
      await client.query("begin");
      const result = await createTenant(client, {
        slug: body.slug,
        name: body.name,
        adminEmail: body.adminEmail,
        adminPassword: body.adminPassword,
        ...(body.adminFullName ? { adminFullName: body.adminFullName } : {}),
        ...(body.locationName ? { locationName: body.locationName } : {}),
        domains,
      });
      await client.query("commit");
      this.logger.log(`platform onboarding: tenant '${body.slug}' created (${result.tenantId})`);
      return { ok: true, value: { tenantId: result.tenantId } };
    } catch (err) {
      await client.query("rollback").catch(() => {});
      const detail = err instanceof Error ? err.message : String(err);
      this.logger.error(`platform onboarding failed for '${body.slug}': ${detail}`);
      return { ok: false, status: 400, message: `Crearea a eșuat: ${detail.slice(0, 200)}` };
    } finally {
      client.release();
    }
  }

  async addDomain(
    tenantId: string,
    body: AddPlatformDomainRequest,
  ): Promise<PlatformResult<{ ok: true }>> {
    if (!platformDbConfigured()) return NOT_CONFIGURED;
    const pool = getPlatformPool();
    const tenant = await pool.query(`select 1 from tenant where id = $1`, [tenantId]);
    if ((tenant.rowCount ?? 0) === 0) {
      return { ok: false, status: 404, message: "Restaurantul nu există." };
    }
    const domain = body.domain.trim().toLowerCase();
    const taken = await pool.query<{ tenant_id: string }>(
      `select tenant_id from tenant_domain where domain = $1::citext`,
      [domain],
    );
    if (taken.rows[0] && taken.rows[0].tenant_id !== tenantId) {
      return { ok: false, status: 409, message: "Domeniul e deja folosit de alt restaurant." };
    }

    const isPrimary = body.isPrimary ?? true;
    const client = await pool.connect();
    try {
      await client.query("begin");
      if (isPrimary) {
        // One primary per (tenant, surface) — demote the current one first.
        await client.query(
          `update tenant_domain set is_primary = false
           where tenant_id = $1 and surface = $2 and is_primary`,
          [tenantId, body.surface],
        );
      }
      await client.query(
        `insert into tenant_domain (tenant_id, domain, surface, is_primary)
         values ($1, $2, $3, $4)
         on conflict (domain) do update
           set tenant_id = excluded.tenant_id,
               surface   = excluded.surface,
               is_primary = excluded.is_primary`,
        [tenantId, domain, body.surface, isPrimary],
      );
      await client.query("commit");
      return { ok: true, value: { ok: true } };
    } catch (err) {
      await client.query("rollback").catch(() => {});
      const detail = err instanceof Error ? err.message : String(err);
      return { ok: false, status: 400, message: `Adăugarea a eșuat: ${detail.slice(0, 200)}` };
    } finally {
      client.release();
    }
  }

  async deleteDomain(domainId: string): Promise<PlatformResult<{ ok: true }>> {
    if (!platformDbConfigured()) return NOT_CONFIGURED;
    const pool = getPlatformPool();
    const res = await pool.query(`delete from tenant_domain where id = $1`, [domainId]);
    if ((res.rowCount ?? 0) === 0) {
      return { ok: false, status: 404, message: "Domeniul nu există." };
    }
    return { ok: true, value: { ok: true } };
  }

  async updateBranding(
    tenantId: string,
    body: UpdatePlatformBrandingRequest,
  ): Promise<PlatformResult<{ ok: true }>> {
    if (!platformDbConfigured()) return NOT_CONFIGURED;
    const pool = getPlatformPool();
    const tenant = await pool.query(`select 1 from tenant where id = $1`, [tenantId]);
    if ((tenant.rowCount ?? 0) === 0) {
      return { ok: false, status: 404, message: "Restaurantul nu există." };
    }
    // Texts + palette only; logo_media_id is deliberately untouched (it belongs
    // to the tenant's own media library, managed by the tenant admin).
    await pool.query(
      `insert into tenant_branding (tenant_id, display_name, tagline, greeting, promise, locations, palette, updated_at)
       values ($1, $2, $3, $4, $5, $6, $7, now())
       on conflict (tenant_id) do update
         set display_name = excluded.display_name,
             tagline      = excluded.tagline,
             greeting     = excluded.greeting,
             promise      = excluded.promise,
             locations    = excluded.locations,
             palette      = excluded.palette,
             updated_at   = now()`,
      [
        tenantId,
        body.displayName,
        body.tagline,
        body.greeting,
        body.promise,
        body.locations,
        JSON.stringify(body.colors),
      ],
    );
    return { ok: true, value: { ok: true } };
  }
}
