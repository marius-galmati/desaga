import { apiContract } from "@boca/contracts";
import { Controller, Req } from "@nestjs/common";
import { TsRestHandler, tsRestHandler } from "@ts-rest/nest";
import type { RequestWithPrincipal } from "../../common/principal";
import { Roles } from "../../common/roles.decorator";
import { requirePrincipal } from "../../common/tenant-context";
import { EvaluationService } from "./evaluation.service";

@Controller()
// kitchen_pass drives the plating-capture flow from the staff app; admin/manager
// use it from the owner demo.
@Roles("tenant_admin", "manager", "kitchen_pass")
export class EvaluationController {
  constructor(private readonly evaluations: EvaluationService) {}

  @TsRestHandler(apiContract.evaluation.createEvaluation)
  createEvaluation(@Req() request: RequestWithPrincipal) {
    return tsRestHandler(apiContract.evaluation.createEvaluation, async ({ body }) => {
      const principal = requirePrincipal(request);
      const result = await this.evaluations.createEvaluation(principal, body);
      if (!result.ok) {
        return { status: result.status, body: { message: result.message } };
      }
      return { status: 202 as const, body: result.value };
    });
  }

  @TsRestHandler(apiContract.evaluation.getEvaluation)
  getEvaluation(@Req() request: RequestWithPrincipal) {
    return tsRestHandler(apiContract.evaluation.getEvaluation, async ({ params }) => {
      const principal = requirePrincipal(request);
      const result = await this.evaluations.getEvaluation(principal, params.id);
      if (!result.ok) {
        return { status: 404 as const, body: { message: result.message } };
      }
      return { status: 200 as const, body: result.value };
    });
  }
}
