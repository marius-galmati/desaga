import { apiContract } from "@boca/contracts";
import { Controller, Req } from "@nestjs/common";
import { TsRestHandler, tsRestHandler } from "@ts-rest/nest";
import type { RequestWithPrincipal } from "../../common/principal";
import { Roles } from "../../common/roles.decorator";
import { requirePrincipal } from "../../common/tenant-context";
import { ReferencesService } from "./references.service";

@Controller()
@Roles("tenant_admin", "manager")
export class ReferencesController {
  constructor(private readonly references: ReferencesService) {}

  @TsRestHandler(apiContract.evaluation.createDemoDish)
  createDemoDish(@Req() request: RequestWithPrincipal) {
    return tsRestHandler(apiContract.evaluation.createDemoDish, async ({ body }) => {
      const principal = requirePrincipal(request);
      const result = await this.references.createDemoDish(principal, body);
      if (!result.ok) {
        return { status: 400 as const, body: { message: result.message } };
      }
      return { status: 201 as const, body: result.value };
    });
  }

  @TsRestHandler(apiContract.evaluation.listDemoDishes)
  listDemoDishes(@Req() request: RequestWithPrincipal) {
    return tsRestHandler(apiContract.evaluation.listDemoDishes, async () => {
      const principal = requirePrincipal(request);
      const dishes = await this.references.listDemoDishes(principal);
      return { status: 200 as const, body: dishes };
    });
  }

  @TsRestHandler(apiContract.evaluation.attachReferences)
  attachReferences(@Req() request: RequestWithPrincipal) {
    return tsRestHandler(apiContract.evaluation.attachReferences, async ({ params, body }) => {
      const principal = requirePrincipal(request);
      const result = await this.references.attachReferences(
        principal,
        params.dishId,
        body.imageKeys,
      );
      if (!result.ok) {
        return { status: result.status, body: { message: result.message } };
      }
      return { status: 201 as const, body: result.value };
    });
  }
}
