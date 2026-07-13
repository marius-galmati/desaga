import { UnauthorizedException } from "@nestjs/common";
import type { Principal, RequestWithPrincipal } from "./principal";

/**
 * TENANT-CONTEXT PATTERN — explicit parameter passing (deliberately chosen
 * over request-scoped providers / AsyncLocalStorage):
 *
 *   1. JwtAuthGuard (global) verifies the Bearer access token and attaches
 *      `request.principal` — userId/tenantId/role/locationId straight from
 *      the JWT claims (sub/tid/rol/loc). No DB hit.
 *   2. Controllers call `requirePrincipal(request)` and hand the Principal to
 *      services as a plain argument.
 *   3. Services open every query through `withTenant(principal.tenantId, fn)`
 *      from @boca/db, which runs `SET LOCAL app.tenant_id` inside a
 *      transaction — the RLS policies do the actual tenant fencing.
 *
 * Why explicit and not request-scoped DI: no per-request provider tree
 * re-instantiation, no hidden ambient state, and the tenant id is visible at
 * every call site that touches the database. @boca/db does not export the
 * Kysely instance, so a query path that skips step 3 does not typecheck —
 * the pattern is structurally enforced, not a convention.
 */
export function requirePrincipal(request: RequestWithPrincipal): Principal {
  if (!request.principal) {
    // Unreachable behind the global JwtAuthGuard on non-@Public routes;
    // fail closed anyway (e.g. a handler accidentally marked @Public).
    throw new UnauthorizedException("Unauthorized");
  }
  return request.principal;
}
