import { apiContract } from "@boca/contracts";
import { Controller, Req } from "@nestjs/common";
import { TsRestHandler, tsRestHandler } from "@ts-rest/nest";
import type { RequestWithPrincipal } from "../../common/principal";
import { Roles } from "../../common/roles.decorator";
import { requirePrincipal } from "../../common/tenant-context";
import { EvaluationService } from "./evaluation.service";

// Staff pass surface: kitchen_pass drives it from apps/staff; admin/manager may
// also use it. Binds captures to REAL order items (not demo fixtures).
@Controller()
@Roles("tenant_admin", "manager", "kitchen_pass")
export class StaffController {
  constructor(private readonly evaluations: EvaluationService) {}

  @TsRestHandler(apiContract.staff.passQueue)
  passQueue(@Req() request: RequestWithPrincipal) {
    return tsRestHandler(apiContract.staff.passQueue, async () => {
      const principal = requirePrincipal(request);
      return { status: 200 as const, body: await this.evaluations.listPassQueue(principal) };
    });
  }

  @TsRestHandler(apiContract.staff.capture)
  capture(@Req() request: RequestWithPrincipal) {
    return tsRestHandler(apiContract.staff.capture, async ({ body }) => {
      const principal = requirePrincipal(request);
      const result = await this.evaluations.createEvaluationForOrderItem(principal, body);
      if (!result.ok) {
        return { status: result.status, body: { message: result.message } };
      }
      return { status: 202 as const, body: result.value };
    });
  }

  @TsRestHandler(apiContract.staff.getCapture)
  getCapture(@Req() request: RequestWithPrincipal) {
    return tsRestHandler(apiContract.staff.getCapture, async ({ params }) => {
      const principal = requirePrincipal(request);
      const result = await this.evaluations.getEvaluation(principal, params.id);
      if (!result.ok) {
        return { status: 404 as const, body: { message: result.message } };
      }
      return { status: 200 as const, body: result.value };
    });
  }
}
