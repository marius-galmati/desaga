import { apiContract } from "@boca/contracts";
import { Controller, Req } from "@nestjs/common";
import { TsRestHandler, tsRestHandler } from "@ts-rest/nest";
import type { RequestWithPrincipal } from "../../common/principal";
import { Roles } from "../../common/roles.decorator";
import { requirePrincipal } from "../../common/tenant-context";
import { MetricsService } from "./metrics.service";

// The management dashboard. management_viewer's ONLY surface — a read-only
// plating-conformity report, not the back-office. Managers/admins see it too.
@Controller()
@Roles("tenant_admin", "manager", "management_viewer")
export class AdminMetricsController {
  constructor(private readonly metrics: MetricsService) {}

  @TsRestHandler(apiContract.admin.getMetrics)
  getMetrics(@Req() request: RequestWithPrincipal) {
    return tsRestHandler(apiContract.admin.getMetrics, async ({ query }) => {
      const principal = requirePrincipal(request);
      const data = await this.metrics.getMetrics(principal, query.period ?? "month");
      return { status: 200 as const, body: data };
    });
  }
}
