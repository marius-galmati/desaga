import { createHash, randomBytes } from "node:crypto";
import type { AuthUser, LoginResponse, MePayload } from "@boca/contracts";
import {
  findActiveRefreshToken,
  findActiveUserByEmail,
  findActiveUserById,
  findTenantById,
  insertRefreshToken,
  listActiveLocations,
  resolveTenantIdBySlug,
  revokeRefreshTokenByHash,
  revokeRefreshTokenById,
  withTenant,
} from "@boca/db";
import { Inject, Injectable } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import * as argon2 from "argon2";
import { z } from "zod";
import type { Principal } from "../../common/principal";
import { ENV, type Env } from "../../config/env";

/**
 * TENANT RESOLUTION AT LOGIN — login happens BEFORE any tenant context exists,
 * and app_user.email is unique PER TENANT (UNIQUE (tenant_id, email) in
 * migration 0004), NOT globally: the same person may work at two restaurants.
 * So the login request carries a tenant slug, resolved through the
 * SECURITY DEFINER function resolve_tenant_slug (the one sanctioned pre-tenant
 * query path, wrapped by resolveTenantIdBySlug). Only then can withTenant()
 * open an RLS-scoped transaction to find the user row.
 *
 * REFRESH is the same pre-tenant moment: the opaque refresh token embeds the
 * tenant id ("v1.<tenantId>.<random>") because its auth_refresh_token row is
 * only readable AFTER SET LOCAL app.tenant_id. Only the token's sha256 is
 * stored; rotation revokes the presented token in the same transaction.
 */
const REFRESH_TOKEN_VERSION = "v1";

type UserRow = NonNullable<Awaited<ReturnType<typeof findActiveUserByEmail>>>;

function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function toAuthUser(user: UserRow): AuthUser {
  return {
    id: user.id,
    tenantId: user.tenant_id,
    locationId: user.location_id,
    role: user.role,
    email: user.email,
    fullName: user.full_name,
  };
}

@Injectable()
export class AuthService {
  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly jwt: JwtService,
  ) {}

  async login(input: {
    tenantSlug: string;
    email: string;
    password: string;
    ip?: string | undefined;
  }): Promise<LoginResponse | null> {
    const tenantId = await resolveTenantIdBySlug(input.tenantSlug);
    if (!tenantId) {
      return null;
    }

    const user = await withTenant(tenantId, (trx) => findActiveUserByEmail(trx, input.email));
    if (!user) {
      // Burn comparable time to blunt user-enumeration timing.
      await argon2.hash(input.password);
      return null;
    }

    const passwordOk = await argon2.verify(user.password_hash, input.password);
    if (!passwordOk) {
      return null;
    }

    const refreshToken = this.generateRefreshToken(tenantId);
    await withTenant(tenantId, (trx) =>
      insertRefreshToken(trx, {
        tenantId,
        userId: user.id,
        tokenHash: sha256Hex(refreshToken),
        expiresAt: this.refreshExpiry(),
        issuedIp: input.ip ?? null,
      }),
    );

    return this.buildResponse(user, refreshToken);
  }

  /** Rotates the refresh token: the presented one is revoked in the same tx. */
  async refresh(refreshToken: string, ip?: string): Promise<LoginResponse | null> {
    const tenantId = this.parseTenantId(refreshToken);
    if (!tenantId) {
      return null;
    }

    const nextToken = this.generateRefreshToken(tenantId);
    const user = await withTenant(tenantId, async (trx) => {
      const row = await findActiveRefreshToken(trx, sha256Hex(refreshToken));
      if (!row) {
        return null;
      }
      const found = await findActiveUserById(trx, row.user_id);
      if (!found) {
        return null;
      }
      await revokeRefreshTokenById(trx, row.id);
      await insertRefreshToken(trx, {
        tenantId,
        userId: found.id,
        tokenHash: sha256Hex(nextToken),
        expiresAt: this.refreshExpiry(),
        issuedIp: ip ?? null,
      });
      return found;
    });

    return user ? this.buildResponse(user, nextToken) : null;
  }

  async logout(refreshToken: string): Promise<void> {
    const tenantId = this.parseTenantId(refreshToken);
    if (!tenantId) {
      return;
    }
    await withTenant(tenantId, (trx) => revokeRefreshTokenByHash(trx, sha256Hex(refreshToken)));
  }

  /** Bootstrap payload: user + tenant + locations in ONE RLS-scoped tx. */
  async me(principal: Principal): Promise<MePayload | null> {
    return withTenant(principal.tenantId, async (trx) => {
      const user = await findActiveUserById(trx, principal.userId);
      if (!user) {
        return null;
      }
      const tenant = await findTenantById(trx, principal.tenantId);
      if (!tenant) {
        return null;
      }
      const locations = await listActiveLocations(trx);
      return {
        user: toAuthUser(user),
        tenant: { id: tenant.id, slug: tenant.slug, name: tenant.name },
        locations: locations.map((row) => ({
          id: row.id,
          name: row.name,
          timezone: row.timezone,
          address: row.address,
        })),
      };
    });
  }

  private async buildResponse(user: UserRow, refreshToken: string): Promise<LoginResponse> {
    const accessToken = await this.jwt.signAsync(
      // Claims: sub = user id, tid = tenant_id, rol = role, loc = home
      // location_id (nullable) — validated by accessTokenPayloadSchema.
      { sub: user.id, tid: user.tenant_id, rol: user.role, loc: user.location_id },
      { expiresIn: this.env.JWT_ACCESS_TTL_SECONDS },
    );
    return {
      user: toAuthUser(user),
      tokens: {
        accessToken,
        refreshToken,
        accessTokenExpiresInSeconds: this.env.JWT_ACCESS_TTL_SECONDS,
      },
    };
  }

  private generateRefreshToken(tenantId: string): string {
    return `${REFRESH_TOKEN_VERSION}.${tenantId}.${randomBytes(32).toString("base64url")}`;
  }

  private parseTenantId(refreshToken: string): string | null {
    const parts = refreshToken.split(".");
    if (parts.length !== 3 || parts[0] !== REFRESH_TOKEN_VERSION) {
      return null;
    }
    const tenantId = z.string().uuid().safeParse(parts[1]);
    return tenantId.success ? tenantId.data : null;
  }

  private refreshExpiry(): Date {
    return new Date(Date.now() + this.env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);
  }
}
