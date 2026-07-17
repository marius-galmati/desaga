import { apiContract } from "@boca/contracts";
import { Controller, UseGuards } from "@nestjs/common";
import { TsRestHandler, tsRestHandler } from "@ts-rest/nest";
import { Public } from "../../common/public.decorator";
import { PlatformService } from "./platform.service";
import { PlatformAuthGuard } from "./platform-auth.guard";

// Every handler is @Public to SKIP the global tenant-JWT guard, then the
// protected ones apply the dedicated PlatformAuthGuard (platform JWT type).
@Controller()
export class PlatformController {
  constructor(private readonly platform: PlatformService) {}

  @Public()
  @TsRestHandler(apiContract.platform.login)
  login() {
    return tsRestHandler(apiContract.platform.login, async ({ body }) => {
      const result = await this.platform.login(body.email, body.password);
      if (!result.ok) {
        return {
          status: result.status === 503 ? (503 as const) : (401 as const),
          body: { message: result.message },
        };
      }
      return { status: 200 as const, body: result.value };
    });
  }

  @Public()
  @UseGuards(PlatformAuthGuard)
  @TsRestHandler(apiContract.platform.listTenants)
  listTenants() {
    return tsRestHandler(apiContract.platform.listTenants, async () => {
      const result = await this.platform.listTenants();
      if (!result.ok) {
        return { status: 503 as const, body: { message: result.message } };
      }
      return { status: 200 as const, body: result.value };
    });
  }

  @Public()
  @UseGuards(PlatformAuthGuard)
  @TsRestHandler(apiContract.platform.createTenant)
  createTenant() {
    return tsRestHandler(apiContract.platform.createTenant, async ({ body }) => {
      const result = await this.platform.createTenant(body);
      if (!result.ok) {
        return { status: result.status, body: { message: result.message } };
      }
      return { status: 201 as const, body: result.value };
    });
  }

  @Public()
  @UseGuards(PlatformAuthGuard)
  @TsRestHandler(apiContract.platform.addDomain)
  addDomain() {
    return tsRestHandler(apiContract.platform.addDomain, async ({ params, body }) => {
      const result = await this.platform.addDomain(params.id, body);
      if (!result.ok) {
        return { status: result.status, body: { message: result.message } };
      }
      return { status: 200 as const, body: result.value };
    });
  }

  @Public()
  @UseGuards(PlatformAuthGuard)
  @TsRestHandler(apiContract.platform.deleteDomain)
  deleteDomain() {
    return tsRestHandler(apiContract.platform.deleteDomain, async ({ params }) => {
      const result = await this.platform.deleteDomain(params.id);
      if (!result.ok) {
        return { status: result.status, body: { message: result.message } };
      }
      return { status: 200 as const, body: result.value };
    });
  }

  @Public()
  @UseGuards(PlatformAuthGuard)
  @TsRestHandler(apiContract.platform.updateBranding)
  updateBranding() {
    return tsRestHandler(apiContract.platform.updateBranding, async ({ params, body }) => {
      const result = await this.platform.updateBranding(params.id, body);
      if (!result.ok) {
        return { status: result.status, body: { message: result.message } };
      }
      return { status: 200 as const, body: result.value };
    });
  }
}
