import { describe, expect, it } from "vitest";
import { apiContract, loginRequestSchema, userRoleSchema } from "../src";

describe("auth schemas", () => {
  it("accepts a valid login payload", () => {
    const parsed = loginRequestSchema.safeParse({
      tenantSlug: "boca-centru",
      email: "chef@boca.ro",
      password: "s3cret-pass",
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects a short password and a bad email", () => {
    expect(
      loginRequestSchema.safeParse({ tenantSlug: "x", email: "nope", password: "short" }).success,
    ).toBe(false);
  });

  it("keeps the 5 tenant staff roles in sync with db user_role", () => {
    expect(userRoleSchema.options).toEqual([
      "tenant_admin",
      "manager",
      "waiter",
      "kitchen_pass",
      "management_viewer",
    ]);
  });
});

describe("api contract", () => {
  it("exposes health, auth and tenancy routers", () => {
    expect(apiContract.health.check.path).toBe("/health");
    expect(apiContract.auth.login.method).toBe("POST");
    expect(apiContract.tenancy.listLocations.path).toBe("/tenancy/locations");
  });
});
