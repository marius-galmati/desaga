import { apiContract } from "@boca/contracts";
import { Controller, Req } from "@nestjs/common";
import { TsRestHandler, tsRestHandler } from "@ts-rest/nest";
import type { RequestWithPrincipal } from "../../common/principal";
import { Roles } from "../../common/roles.decorator";
import { requirePrincipal } from "../../common/tenant-context";
import { DishService } from "./dish.service";

@Controller()
@Roles("tenant_admin", "manager")
export class AdminDishController {
  constructor(private readonly dishes: DishService) {}

  // Method-level override: the staff plating app (kitchen_pass) reads the dish
  // list to pick what to capture — but must NOT reach dish mutations below.
  @Roles("tenant_admin", "manager", "kitchen_pass")
  @TsRestHandler(apiContract.admin.listDishes)
  listDishes(@Req() request: RequestWithPrincipal) {
    return tsRestHandler(apiContract.admin.listDishes, async ({ query }) => {
      const principal = requirePrincipal(request);
      const data = await this.dishes.listDishes(principal, query.categoryId);
      return { status: 200 as const, body: data };
    });
  }

  @TsRestHandler(apiContract.admin.getDish)
  getDish(@Req() request: RequestWithPrincipal) {
    return tsRestHandler(apiContract.admin.getDish, async ({ params }) => {
      const principal = requirePrincipal(request);
      const result = await this.dishes.getDish(principal, params.id);
      if (!result.ok) {
        return { status: result.status, body: { message: result.message } };
      }
      return { status: 200 as const, body: result.value };
    });
  }

  @TsRestHandler(apiContract.admin.createDish)
  createDish(@Req() request: RequestWithPrincipal) {
    return tsRestHandler(apiContract.admin.createDish, async ({ body }) => {
      const principal = requirePrincipal(request);
      const result = await this.dishes.createDish(principal, body);
      if (!result.ok) {
        return { status: result.status, body: { message: result.message } };
      }
      return { status: 201 as const, body: result.value };
    });
  }

  @TsRestHandler(apiContract.admin.updateDish)
  updateDish(@Req() request: RequestWithPrincipal) {
    return tsRestHandler(apiContract.admin.updateDish, async ({ params, body }) => {
      const principal = requirePrincipal(request);
      const result = await this.dishes.updateDish(principal, params.id, body);
      if (!result.ok) {
        return { status: result.status, body: { message: result.message } };
      }
      return { status: 200 as const, body: result.value };
    });
  }

  @TsRestHandler(apiContract.admin.setDishAvailability)
  setDishAvailability(@Req() request: RequestWithPrincipal) {
    return tsRestHandler(apiContract.admin.setDishAvailability, async ({ params, body }) => {
      const principal = requirePrincipal(request);
      const result = await this.dishes.setAvailability(principal, params.id, body);
      if (!result.ok) {
        return { status: result.status, body: { message: result.message } };
      }
      return { status: 200 as const, body: result.value };
    });
  }

  @TsRestHandler(apiContract.admin.archiveDish)
  archiveDish(@Req() request: RequestWithPrincipal) {
    return tsRestHandler(apiContract.admin.archiveDish, async ({ params }) => {
      const principal = requirePrincipal(request);
      const result = await this.dishes.archiveDish(principal, params.id);
      if (!result.ok) {
        return { status: result.status, body: { message: result.message } };
      }
      return { status: 200 as const, body: result.value };
    });
  }

  @TsRestHandler(apiContract.admin.getReferenceSet)
  getReferenceSet(@Req() request: RequestWithPrincipal) {
    return tsRestHandler(apiContract.admin.getReferenceSet, async ({ params }) => {
      const principal = requirePrincipal(request);
      const result = await this.dishes.getReferenceSet(principal, params.id);
      if (!result.ok) {
        return { status: result.status, body: { message: result.message } };
      }
      return { status: 200 as const, body: result.value };
    });
  }

  @TsRestHandler(apiContract.admin.createReferenceSet)
  createReferenceSet(@Req() request: RequestWithPrincipal) {
    return tsRestHandler(apiContract.admin.createReferenceSet, async ({ params, body }) => {
      const principal = requirePrincipal(request);
      const result = await this.dishes.createReferenceSet(principal, params.id, body);
      if (!result.ok) {
        return { status: result.status, body: { message: result.message } };
      }
      return { status: 201 as const, body: result.value };
    });
  }

  @TsRestHandler(apiContract.admin.getTolerance)
  getTolerance(@Req() request: RequestWithPrincipal) {
    return tsRestHandler(apiContract.admin.getTolerance, async ({ params }) => {
      const principal = requirePrincipal(request);
      const result = await this.dishes.getTolerance(principal, params.id);
      if (!result.ok) {
        return { status: result.status, body: { message: result.message } };
      }
      return { status: 200 as const, body: result.value };
    });
  }

  @TsRestHandler(apiContract.admin.putTolerance)
  putTolerance(@Req() request: RequestWithPrincipal) {
    return tsRestHandler(apiContract.admin.putTolerance, async ({ params, body }) => {
      const principal = requirePrincipal(request);
      const result = await this.dishes.putTolerance(principal, params.id, body.criteria);
      if (!result.ok) {
        return { status: result.status, body: { message: result.message } };
      }
      return { status: 200 as const, body: result.value };
    });
  }
}
