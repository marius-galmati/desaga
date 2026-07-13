import { authContract } from "@boca/contracts";
import { Controller, Req } from "@nestjs/common";
import { TsRestHandler, tsRestHandler } from "@ts-rest/nest";
import type { RequestWithPrincipal } from "../../common/principal";
import { Public } from "../../common/public.decorator";
import { requirePrincipal } from "../../common/tenant-context";
import { AuthService } from "./auth.service";

@Controller()
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @TsRestHandler(authContract.login)
  login(@Req() request: RequestWithPrincipal) {
    return tsRestHandler(authContract.login, async ({ body }) => {
      const result = await this.auth.login({ ...body, ip: request.ip });
      if (!result) {
        return { status: 401, body: { message: "Invalid credentials" } };
      }
      return { status: 200, body: result };
    });
  }

  @Public()
  @TsRestHandler(authContract.refresh)
  refresh(@Req() request: RequestWithPrincipal) {
    return tsRestHandler(authContract.refresh, async ({ body }) => {
      const result = await this.auth.refresh(body.refreshToken, request.ip);
      if (!result) {
        return { status: 401, body: { message: "Invalid refresh token" } };
      }
      return { status: 200, body: result };
    });
  }

  @Public()
  @TsRestHandler(authContract.logout)
  logout() {
    return tsRestHandler(authContract.logout, async ({ body }) => {
      await this.auth.logout(body.refreshToken);
      return { status: 200, body: { ok: true as const } };
    });
  }

  @TsRestHandler(authContract.me)
  me(@Req() request: RequestWithPrincipal) {
    return tsRestHandler(authContract.me, async () => {
      const principal = requirePrincipal(request);
      const payload = await this.auth.me(principal);
      if (!payload) {
        return { status: 401 as const, body: { message: "User no longer active" } };
      }
      return { status: 200 as const, body: payload };
    });
  }
}
