import { describe, expect, it } from "vitest";
import { loadEnv } from "../src/config/env";

const validEnv = {
  DATABASE_URL: "postgres://boca:boca@localhost:5432/boca",
  JWT_ACCESS_SECRET: "0123456789abcdef-not-a-real-secret",
};

describe("loadEnv", () => {
  it("rejects an empty environment and names the missing keys", () => {
    expect(() => loadEnv({})).toThrow(/DATABASE_URL/);
    expect(() => loadEnv({})).toThrow(/JWT_ACCESS_SECRET/);
  });

  it("applies defaults and coerces numbers", () => {
    const env = loadEnv({ ...validEnv, PORT: "8080" });
    expect(env.PORT).toBe(8080);
    expect(env.NODE_ENV).toBe("development");
    expect(env.JWT_ACCESS_TTL_SECONDS).toBe(900);
    expect(env.REFRESH_TOKEN_TTL_DAYS).toBe(30);
  });

  it("rejects a too-short JWT secret", () => {
    expect(() => loadEnv({ ...validEnv, JWT_ACCESS_SECRET: "short" })).toThrow(/JWT_ACCESS_SECRET/);
  });

  it("treats JWT_REFRESH_SECRET as optional but validates it when present", () => {
    expect(loadEnv(validEnv).JWT_REFRESH_SECRET).toBeUndefined();
    expect(
      loadEnv({ ...validEnv, JWT_REFRESH_SECRET: "0123456789abcdef" }).JWT_REFRESH_SECRET,
    ).toBe("0123456789abcdef");
    expect(() => loadEnv({ ...validEnv, JWT_REFRESH_SECRET: "short" })).toThrow(
      /JWT_REFRESH_SECRET/,
    );
  });
});
