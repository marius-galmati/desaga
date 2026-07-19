import {
  type AddPlatformDomainRequest,
  type AiCostPeriod,
  type AiCostReport,
  type AiModelList,
  type AiProvider,
  type AiSettings,
  brandColorsSchema,
  type CreatePlatformTenantRequest,
  type PlatformBranding,
  type PlatformLoginResponse,
  type PlatformTenant,
  type UpdateAiPricesRequest,
  type UpdateAiSettingsRequest,
  type UpdatePlatformBrandingRequest,
} from "@boca/contracts";
import { Injectable, Logger } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import * as argon2 from "argon2";
import { decryptSecret, encryptSecret, secretsConfigured } from "../../common/secrets";
import { getEnv } from "../../config/env";
import { fetchAiModels } from "./ai-models";
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

  // --- AI runtime config + costs ------------------------------------------

  private async readAiSettings(): Promise<AiSettings> {
    const pool = getPlatformPool();
    const s = await pool.query<{
      provider: string;
      base_url: string | null;
      model: string | null;
      api_key_ciphertext: string | null;
      api_key_last4: string | null;
    }>(
      `select provider, base_url, model, api_key_ciphertext, api_key_last4
       from ai_settings where singleton`,
    );
    const prices = await pool.query<{
      model: string;
      label: string | null;
      input_per_million: string;
      output_per_million: string;
    }>(
      `select model, label, input_per_million, output_per_million
       from ai_model_price order by model`,
    );
    const row = s.rows[0];
    return {
      provider: row?.provider === "openai" ? "openai" : "anthropic",
      baseUrl: row?.base_url ?? null,
      model: row?.model ?? null,
      hasKey: Boolean(row?.api_key_ciphertext),
      keyLast4: row?.api_key_last4 ?? null,
      secretsConfigured: secretsConfigured(),
      prices: prices.rows.map((p) => ({
        model: p.model,
        label: p.label,
        inputPerMillion: Number(p.input_per_million),
        outputPerMillion: Number(p.output_per_million),
      })),
    };
  }

  async getAiSettings(): Promise<PlatformResult<AiSettings>> {
    if (!platformDbConfigured()) return NOT_CONFIGURED;
    return { ok: true, value: await this.readAiSettings() };
  }

  // Reads the stored provider key (decrypted, if any) to authenticate the live
  // model-catalog fetch. The OpenRouter /models list is public, so a missing
  // key still yields a full list there; Anthropic needs a key or falls back.
  async listAiModels(
    provider: AiProvider,
    baseUrl?: string,
  ): Promise<PlatformResult<AiModelList>> {
    if (!platformDbConfigured()) return NOT_CONFIGURED;
    const pool = getPlatformPool();
    const s = await pool.query<{
      provider: string;
      api_key_ciphertext: string | null;
      api_key_iv: string | null;
      api_key_tag: string | null;
    }>(
      `select provider, api_key_ciphertext, api_key_iv, api_key_tag
       from ai_settings where singleton`,
    );
    const row = s.rows[0];
    const storedProvider = row?.provider === "openai" ? "openai" : "anthropic";
    const storedKey =
      row?.api_key_ciphertext && row.api_key_iv && row.api_key_tag
        ? decryptSecret({
            ciphertext: row.api_key_ciphertext,
            iv: row.api_key_iv,
            tag: row.api_key_tag,
          })
        : null;
    // Only hand the stored key to a matching provider; Anthropic can also use
    // the server's ANTHROPIC_API_KEY as a fallback for its live list.
    let apiKey: string | null = storedProvider === provider ? storedKey : null;
    if (provider === "anthropic" && !apiKey) {
      apiKey = getEnv().ANTHROPIC_API_KEY ?? null;
    }
    const models = await fetchAiModels({
      provider,
      ...(baseUrl ? { baseUrl } : {}),
      apiKey,
    });
    return { ok: true, value: models };
  }

  async updateAiSettings(body: UpdateAiSettingsRequest): Promise<PlatformResult<AiSettings>> {
    if (!platformDbConfigured()) return NOT_CONFIGURED;
    const pool = getPlatformPool();
    if (body.apiKey === undefined) {
      // Keep the stored key; update provider/base_url/model only.
      await pool.query(
        `insert into ai_settings (singleton, provider, base_url, model, updated_at)
         values (true, $1, $2, $3, now())
         on conflict (singleton) do update
           set provider = $1, base_url = $2, model = $3, updated_at = now()`,
        [body.provider, body.baseUrl, body.model],
      );
    } else if (body.apiKey === "") {
      // Clear the stored key.
      await pool.query(
        `insert into ai_settings (singleton, provider, base_url, model,
             api_key_ciphertext, api_key_iv, api_key_tag, api_key_last4, updated_at)
         values (true, $1, $2, $3, null, null, null, null, now())
         on conflict (singleton) do update
           set provider = $1, base_url = $2, model = $3,
               api_key_ciphertext = null, api_key_iv = null, api_key_tag = null,
               api_key_last4 = null, updated_at = now()`,
        [body.provider, body.baseUrl, body.model],
      );
    } else {
      if (!secretsConfigured()) {
        return {
          ok: false,
          status: 400,
          message:
            "Setează SECRETS_ENCRYPTION_KEY (și redeploy) ca să poți stoca chei API din dashboard.",
        };
      }
      const enc = encryptSecret(body.apiKey);
      await pool.query(
        `insert into ai_settings (singleton, provider, base_url, model,
             api_key_ciphertext, api_key_iv, api_key_tag, api_key_last4, updated_at)
         values (true, $1, $2, $3, $4, $5, $6, $7, now())
         on conflict (singleton) do update
           set provider = $1, base_url = $2, model = $3,
               api_key_ciphertext = $4, api_key_iv = $5, api_key_tag = $6,
               api_key_last4 = $7, updated_at = now()`,
        [
          body.provider,
          body.baseUrl,
          body.model,
          enc.ciphertext,
          enc.iv,
          enc.tag,
          body.apiKey.slice(-4),
        ],
      );
    }
    return { ok: true, value: await this.readAiSettings() };
  }

  async updateAiPrices(body: UpdateAiPricesRequest): Promise<PlatformResult<AiSettings>> {
    if (!platformDbConfigured()) return NOT_CONFIGURED;
    const pool = getPlatformPool();
    const client = await pool.connect();
    try {
      await client.query("begin");
      // Replace-all: the editor sends the full list.
      await client.query("delete from ai_model_price");
      for (const p of body.prices) {
        await client.query(
          `insert into ai_model_price (model, label, input_per_million, output_per_million, updated_at)
           values ($1, $2, $3, $4, now())`,
          [p.model.trim(), p.label, p.inputPerMillion, p.outputPerMillion],
        );
      }
      await client.query("commit");
    } catch (err) {
      await client.query("rollback").catch(() => {});
      const detail = err instanceof Error ? err.message : String(err);
      return {
        ok: false,
        status: 400,
        message: `Salvarea prețurilor a eșuat: ${detail.slice(0, 200)}`,
      };
    } finally {
      client.release();
    }
    return { ok: true, value: await this.readAiSettings() };
  }

  async getAiCosts(period: AiCostPeriod): Promise<PlatformResult<AiCostReport>> {
    if (!platformDbConfigured()) return NOT_CONFIGURED;
    const pool = getPlatformPool();
    const since = period === "all" ? null : new Date(Date.now() - AI_COST_PERIOD_MS[period]);
    const where = since ? "and e.created_at >= $1" : "";
    const params = since ? [since] : [];
    // Real billed cost when present, else tokens x the price sheet.
    const cost = `coalesce(e.cost_usd,
      (coalesce(e.input_tokens,0)::numeric / 1000000) * coalesce(p.input_per_million, 0)
      + (coalesce(e.output_tokens,0)::numeric / 1000000) * coalesce(p.output_per_million, 0))`;

    const byModel = await pool.query<{
      model: string;
      label: string | null;
      calls: number;
      input_tokens: string;
      output_tokens: string;
      cost: string;
    }>(
      `select e.model_id as model, max(p.label) as label, count(*)::int as calls,
              coalesce(sum(e.input_tokens),0)::bigint as input_tokens,
              coalesce(sum(e.output_tokens),0)::bigint as output_tokens,
              coalesce(sum(${cost}),0) as cost
       from ai_evaluation e
       left join ai_model_price p on p.model = e.model_id
       where e.status = 'completed' and e.deleted_at is null ${where}
       group by e.model_id
       order by cost desc`,
      params,
    );
    const byTenant = await pool.query<{
      tenant_id: string;
      name: string;
      calls: number;
      cost: string;
    }>(
      `select e.tenant_id, t.name, count(*)::int as calls, coalesce(sum(${cost}),0) as cost
       from ai_evaluation e
       left join ai_model_price p on p.model = e.model_id
       join tenant t on t.id = e.tenant_id
       where e.status = 'completed' and e.deleted_at is null ${where}
       group by e.tenant_id, t.name
       order by cost desc`,
      params,
    );

    const byModelOut = byModel.rows.map((r) => ({
      model: r.model,
      label: r.label,
      calls: r.calls,
      inputTokens: Number(r.input_tokens),
      outputTokens: Number(r.output_tokens),
      costUsd: Number(r.cost),
    }));
    return {
      ok: true,
      value: {
        period,
        rangeLabel: AI_COST_RANGE_LABEL[period],
        totalCostUsd: byModelOut.reduce((s, m) => s + m.costUsd, 0),
        totalCalls: byModelOut.reduce((s, m) => s + m.calls, 0),
        byModel: byModelOut,
        byTenant: byTenant.rows.map((r) => ({
          tenantId: r.tenant_id,
          name: r.name,
          calls: r.calls,
          costUsd: Number(r.cost),
        })),
      },
    };
  }
}

const AI_COST_PERIOD_MS: Record<Exclude<AiCostPeriod, "all">, number> = {
  day: 24 * 60 * 60 * 1000,
  week: 7 * 24 * 60 * 60 * 1000,
  month: 30 * 24 * 60 * 60 * 1000,
};

const AI_COST_RANGE_LABEL: Record<AiCostPeriod, string> = {
  day: "Ultimele 24 de ore",
  week: "Ultimele 7 zile",
  month: "Ultimele 30 de zile",
  all: "De la început",
};
