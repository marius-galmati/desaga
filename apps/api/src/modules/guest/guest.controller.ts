import { apiContract } from "@boca/contracts";
import { Controller, Req } from "@nestjs/common";
import { TsRestHandler, tsRestHandler } from "@ts-rest/nest";
import type { RequestWithPrincipal } from "../../common/principal";
import { Public } from "../../common/public.decorator";
import { GuestService } from "./guest.service";

/** Read the raw guest device token from the X-Guest-Token header (empty if absent). */
function guestToken(request: RequestWithPrincipal): string {
  const headers = request.headers as Record<string, string | string[] | undefined>;
  const raw = headers["x-guest-token"];
  return (Array.isArray(raw) ? raw[0] : raw) ?? "";
}

/**
 * The public hostname the browser addressed. Requests arrive through Traefik
 * (sets X-Forwarded-Host) and the Next /api rewrite proxy (forwards it; its own
 * Host is the internal boca-api alias), so the forwarded header wins.
 */
function requestHost(request: RequestWithPrincipal): string {
  const headers = request.headers as Record<string, string | string[] | undefined>;
  const forwarded = headers["x-forwarded-host"];
  const host = headers.host;
  const pick = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
  return pick(forwarded) || pick(host);
}

@Controller()
export class GuestController {
  constructor(private readonly guest: GuestService) {}

  @Public()
  @TsRestHandler(apiContract.guest.getTenantContext)
  getTenantContext(@Req() request: RequestWithPrincipal) {
    return tsRestHandler(apiContract.guest.getTenantContext, async () => {
      const context = await this.guest.getTenantContext(requestHost(request));
      if (!context) {
        return { status: 404 as const, body: { message: "unknown domain" } };
      }
      return { status: 200 as const, body: context };
    });
  }

  @Public()
  @TsRestHandler(apiContract.guest.getMenu)
  getMenu() {
    return tsRestHandler(apiContract.guest.getMenu, async ({ params }) => {
      const menu = await this.guest.getMenu(params.tenantSlug);
      if (!menu) {
        return { status: 404 as const, body: { message: "tenant not found" } };
      }
      return { status: 200 as const, body: menu };
    });
  }

  @Public()
  @TsRestHandler(apiContract.guest.getTables)
  getTables() {
    return tsRestHandler(apiContract.guest.getTables, async ({ params }) => {
      const tables = await this.guest.getTables(params.tenantSlug);
      if (!tables) {
        return { status: 404 as const, body: { message: "tenant not found" } };
      }
      return { status: 200 as const, body: tables };
    });
  }

  @Public()
  @TsRestHandler(apiContract.guest.startSession)
  startSession() {
    return tsRestHandler(apiContract.guest.startSession, async ({ body }) => {
      const session = await this.guest.startSession(body.qrSlug);
      if (!session) {
        return { status: 404 as const, body: { message: "unknown or revoked QR code" } };
      }
      return { status: 200 as const, body: session };
    });
  }

  @Public()
  @TsRestHandler(apiContract.guest.placeOrder)
  placeOrder(@Req() request: RequestWithPrincipal) {
    return tsRestHandler(apiContract.guest.placeOrder, async ({ body }) => {
      const result = await this.guest.placeOrder(guestToken(request), body);
      if (!result.ok) {
        return { status: result.status, body: { message: result.message } };
      }
      return { status: 201 as const, body: result.value };
    });
  }

  @Public()
  @TsRestHandler(apiContract.guest.listOrders)
  listOrders(@Req() request: RequestWithPrincipal) {
    return tsRestHandler(apiContract.guest.listOrders, async () => {
      const orders = await this.guest.listOrders(guestToken(request));
      if (orders === null) {
        return { status: 401 as const, body: { message: "invalid or expired session" } };
      }
      return { status: 200 as const, body: orders };
    });
  }

  @Public()
  @TsRestHandler(apiContract.guest.serviceRequest)
  serviceRequest(@Req() request: RequestWithPrincipal) {
    return tsRestHandler(apiContract.guest.serviceRequest, async ({ body }) => {
      const ok = await this.guest.serviceRequest(guestToken(request), body.kind);
      if (!ok) {
        return { status: 401 as const, body: { message: "invalid or expired session" } };
      }
      return { status: 200 as const, body: { ok: true as const } };
    });
  }

  @Public()
  @TsRestHandler(apiContract.guest.listPlates)
  listPlates(@Req() request: RequestWithPrincipal) {
    return tsRestHandler(apiContract.guest.listPlates, async () => {
      const plates = await this.guest.listPlates(guestToken(request));
      if (plates === null) {
        return { status: 401 as const, body: { message: "invalid or expired session" } };
      }
      return { status: 200 as const, body: plates };
    });
  }
}
