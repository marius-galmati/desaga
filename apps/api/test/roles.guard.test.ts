import "reflect-metadata";
import { type ExecutionContext, ForbiddenException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { describe, expect, it } from "vitest";
import type { Principal } from "../src/common/principal";
import { Roles } from "../src/common/roles.decorator";
import { RolesGuard } from "../src/common/roles.guard";

class Fixture {
  @Roles("manager", "tenant_admin")
  restricted() {}

  open() {}
}

function contextFor(handler: (...args: never[]) => unknown, principal?: Principal) {
  return {
    getHandler: () => handler,
    getClass: () => Fixture,
    switchToHttp: () => ({ getRequest: () => ({ headers: {}, principal }) }),
  } as unknown as ExecutionContext;
}

const guard = new RolesGuard(new Reflector());

describe("RolesGuard", () => {
  it("allows handlers without @Roles metadata", () => {
    const ctx = contextFor(Fixture.prototype.open);
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it("allows a principal with a required role", () => {
    const principal: Principal = { userId: "u", tenantId: "t", role: "manager", locationId: null };
    const ctx = contextFor(Fixture.prototype.restricted, principal);
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it("rejects a principal with an insufficient role", () => {
    const principal: Principal = { userId: "u", tenantId: "t", role: "waiter", locationId: null };
    const ctx = contextFor(Fixture.prototype.restricted, principal);
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });

  it("fails closed when @Roles is present but no principal exists", () => {
    const ctx = contextFor(Fixture.prototype.restricted);
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });
});
