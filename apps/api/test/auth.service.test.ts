import { createHash } from "node:crypto";
import type { JwtService } from "@nestjs/jwt";
import * as argon2 from "argon2";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Principal } from "../src/common/principal";
import type { Env } from "../src/config/env";
import { AuthService } from "../src/modules/auth/auth.service";

// Unit tests: NO real database. @boca/db is mocked wholesale; withTenant just
// runs the callback with a dummy trx so repository mocks are exercised.
vi.mock("@boca/db", () => ({
  withTenant: vi.fn(async (_tenantId: string, fn: (trx: unknown) => Promise<unknown>) => fn({})),
  resolveTenantIdBySlug: vi.fn(),
  findActiveUserByEmail: vi.fn(),
  findActiveUserById: vi.fn(),
  findTenantById: vi.fn(),
  listActiveLocations: vi.fn(),
  insertRefreshToken: vi.fn(),
  findActiveRefreshToken: vi.fn(),
  revokeRefreshTokenById: vi.fn(),
  revokeRefreshTokenByHash: vi.fn(),
}));

vi.mock("argon2", () => ({
  hash: vi.fn(async () => "$argon2id$fake-hash"),
  verify: vi.fn(async () => true),
}));

import * as db from "@boca/db";

const TENANT_ID = "0197b8f0-0000-7000-8000-000000000001";
const USER_ID = "0197b8f0-0000-7000-8000-000000000002";
const LOCATION_ID = "0197b8f0-0000-7000-8000-000000000003";

const userRow = {
  id: USER_ID,
  tenant_id: TENANT_ID,
  location_id: LOCATION_ID,
  role: "tenant_admin" as const,
  email: "admin@demo.local",
  password_hash: "$argon2id$stored-hash",
  full_name: "Demo Admin",
  is_active: true,
  created_at: new Date(),
  updated_at: new Date(),
};

const principal: Principal = {
  userId: USER_ID,
  tenantId: TENANT_ID,
  role: "tenant_admin",
  locationId: LOCATION_ID,
};

function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

const env = {
  JWT_ACCESS_TTL_SECONDS: 900,
  REFRESH_TOKEN_TTL_DAYS: 30,
} as Env;

const signAsync = vi.fn(async () => "signed.access.jwt");
const jwt = { signAsync } as unknown as JwtService;

const service = new AuthService(env, jwt);

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(db.withTenant).mockImplementation(
    async (_tenantId: string, fn: (trx: never) => Promise<unknown>) => fn({} as never),
  );
});

describe("AuthService.login", () => {
  it("returns null for an unknown tenant slug without touching users", async () => {
    vi.mocked(db.resolveTenantIdBySlug).mockResolvedValue(null);
    const result = await service.login({
      tenantSlug: "nope",
      email: "a@b.c",
      password: "x".repeat(8),
    });
    expect(result).toBeNull();
    expect(db.findActiveUserByEmail).not.toHaveBeenCalled();
  });

  it("returns null for an unknown email but burns an argon2 hash (timing)", async () => {
    vi.mocked(db.resolveTenantIdBySlug).mockResolvedValue(TENANT_ID);
    vi.mocked(db.findActiveUserByEmail).mockResolvedValue(undefined);
    const result = await service.login({
      tenantSlug: "demo",
      email: "a@b.c",
      password: "parola123",
    });
    expect(result).toBeNull();
    expect(argon2.hash).toHaveBeenCalledOnce();
    expect(db.insertRefreshToken).not.toHaveBeenCalled();
  });

  it("returns null on a wrong password", async () => {
    vi.mocked(db.resolveTenantIdBySlug).mockResolvedValue(TENANT_ID);
    vi.mocked(db.findActiveUserByEmail).mockResolvedValue(userRow);
    vi.mocked(argon2.verify).mockResolvedValue(false);
    const result = await service.login({
      tenantSlug: "demo",
      email: userRow.email,
      password: "wrong-pass",
    });
    expect(result).toBeNull();
    expect(db.insertRefreshToken).not.toHaveBeenCalled();
  });

  it("issues tokens on success: JWT claims sub/tid/rol/loc + hashed opaque refresh token", async () => {
    vi.mocked(db.resolveTenantIdBySlug).mockResolvedValue(TENANT_ID);
    vi.mocked(db.findActiveUserByEmail).mockResolvedValue(userRow);
    vi.mocked(argon2.verify).mockResolvedValue(true);

    const result = await service.login({
      tenantSlug: "demo",
      email: userRow.email,
      password: "parola123",
    });

    expect(result).not.toBeNull();
    expect(result?.user).toEqual({
      id: USER_ID,
      tenantId: TENANT_ID,
      locationId: LOCATION_ID,
      role: "tenant_admin",
      email: userRow.email,
      fullName: userRow.full_name,
    });
    expect(signAsync).toHaveBeenCalledWith(
      { sub: USER_ID, tid: TENANT_ID, rol: "tenant_admin", loc: LOCATION_ID },
      { expiresIn: 900 },
    );
    expect(result?.tokens.accessToken).toBe("signed.access.jwt");
    expect(result?.tokens.accessTokenExpiresInSeconds).toBe(900);

    // Opaque refresh token embeds the tenant id; only its sha256 hits the DB.
    const refreshToken = result?.tokens.refreshToken ?? "";
    expect(refreshToken.split(".")).toHaveLength(3);
    expect(refreshToken.startsWith(`v1.${TENANT_ID}.`)).toBe(true);
    const insertArgs = vi.mocked(db.insertRefreshToken).mock.calls[0]?.[1];
    expect(insertArgs?.tokenHash).toBe(sha256Hex(refreshToken));
    expect(insertArgs?.tokenHash).not.toBe(refreshToken);
    expect(insertArgs?.userId).toBe(USER_ID);
  });
});

describe("AuthService.refresh", () => {
  it("returns null for a malformed token without any DB access", async () => {
    expect(await service.refresh("not-a-token")).toBeNull();
    expect(await service.refresh("v1.not-a-uuid.abc")).toBeNull();
    expect(db.withTenant).not.toHaveBeenCalled();
  });

  it("returns null when the token row is missing/revoked/expired", async () => {
    vi.mocked(db.findActiveRefreshToken).mockResolvedValue(undefined);
    const result = await service.refresh(`v1.${TENANT_ID}.some-random-part`);
    expect(result).toBeNull();
    expect(db.revokeRefreshTokenById).not.toHaveBeenCalled();
  });

  it("rotates: revokes the presented token and stores the hash of a NEW one", async () => {
    const presented = `v1.${TENANT_ID}.old-random-part`;
    vi.mocked(db.findActiveRefreshToken).mockResolvedValue({
      id: "row-id",
      tenant_id: TENANT_ID,
      user_id: USER_ID,
      token_hash: sha256Hex(presented),
      issued_ip: null,
      expires_at: new Date(Date.now() + 1000_000),
      revoked_at: null,
      created_at: new Date(),
    });
    vi.mocked(db.findActiveUserById).mockResolvedValue(userRow);

    const result = await service.refresh(presented, "127.0.0.1");

    expect(result).not.toBeNull();
    expect(db.findActiveRefreshToken).toHaveBeenCalledWith(expect.anything(), sha256Hex(presented));
    expect(db.revokeRefreshTokenById).toHaveBeenCalledWith(expect.anything(), "row-id");
    const newToken = result?.tokens.refreshToken ?? "";
    expect(newToken).not.toBe(presented);
    const insertArgs = vi.mocked(db.insertRefreshToken).mock.calls[0]?.[1];
    expect(insertArgs?.tokenHash).toBe(sha256Hex(newToken));
  });
});

describe("AuthService.logout", () => {
  it("revokes by hash for a well-formed token and no-ops for garbage", async () => {
    await service.logout("garbage");
    expect(db.revokeRefreshTokenByHash).not.toHaveBeenCalled();

    const token = `v1.${TENANT_ID}.random-part`;
    await service.logout(token);
    expect(db.revokeRefreshTokenByHash).toHaveBeenCalledWith(expect.anything(), sha256Hex(token));
  });
});

describe("AuthService.me", () => {
  it("composes user + tenant + locations in one payload", async () => {
    vi.mocked(db.findActiveUserById).mockResolvedValue(userRow);
    vi.mocked(db.findTenantById).mockResolvedValue({
      id: TENANT_ID,
      slug: "demo",
      name: "Demo Restaurant",
    });
    vi.mocked(db.listActiveLocations).mockResolvedValue([
      { id: LOCATION_ID, name: "Demo Centru", timezone: "Europe/Bucharest", address: null },
    ]);

    const payload = await service.me(principal);

    expect(payload?.user.id).toBe(USER_ID);
    expect(payload?.tenant).toEqual({ id: TENANT_ID, slug: "demo", name: "Demo Restaurant" });
    expect(payload?.locations).toHaveLength(1);
    expect(payload?.locations[0]?.timezone).toBe("Europe/Bucharest");
  });

  it("returns null when the user is gone/inactive", async () => {
    vi.mocked(db.findActiveUserById).mockResolvedValue(undefined);
    expect(await service.me(principal)).toBeNull();
  });
});
