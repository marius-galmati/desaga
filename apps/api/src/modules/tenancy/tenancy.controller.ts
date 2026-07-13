import { tenancyContract } from "@boca/contracts";
import { Controller, Req } from "@nestjs/common";
import { TsRestHandler, tsRestHandler } from "@ts-rest/nest";
import type { RequestWithPrincipal } from "../../common/principal";
import { requirePrincipal } from "../../common/tenant-context";
import { TenancyService } from "./tenancy.service";

@Controller()
export class TenancyController {
  constructor(private readonly tenancy: TenancyService) {}

  @TsRestHandler(tenancyContract.me)
  me(@Req() request: RequestWithPrincipal) {
    return tsRestHandler(tenancyContract.me, async () => {
      const principal = requirePrincipal(request);
      const context = await this.tenancy.getTenantContext(principal);
      if (!context) {
        return { status: 401 as const, body: { message: "Tenant not found or archived" } };
      }
      return { status: 200 as const, body: context };
    });
  }

  @TsRestHandler(tenancyContract.getCurrentTenant)
  getCurrentTenant(@Req() request: RequestWithPrincipal) {
    return tsRestHandler(tenancyContract.getCurrentTenant, async () => {
      const principal = requirePrincipal(request);
      const tenant = await this.tenancy.getCurrentTenant(principal);
      if (!tenant) {
        return { status: 401 as const, body: { message: "Tenant not found or archived" } };
      }
      return { status: 200 as const, body: tenant };
    });
  }

  @TsRestHandler(tenancyContract.listLocations)
  listLocations(@Req() request: RequestWithPrincipal) {
    return tsRestHandler(tenancyContract.listLocations, async () => {
      const principal = requirePrincipal(request);
      const locations = await this.tenancy.listLocations(principal);
      return { status: 200 as const, body: locations };
    });
  }
}
