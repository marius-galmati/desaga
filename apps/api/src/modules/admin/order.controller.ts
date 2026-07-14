import { apiContract } from "@boca/contracts";
import { Controller, Req } from "@nestjs/common";
import { TsRestHandler, tsRestHandler } from "@ts-rest/nest";
import type { RequestWithPrincipal } from "../../common/principal";
import { Roles } from "../../common/roles.decorator";
import { requirePrincipal } from "../../common/tenant-context";
import { OrderService } from "./order.service";

@Controller()
@Roles("tenant_admin", "manager", "waiter")
export class AdminOrderController {
  constructor(private readonly orders: OrderService) {}

  @TsRestHandler(apiContract.admin.listOrders)
  listOrders(@Req() request: RequestWithPrincipal) {
    return tsRestHandler(apiContract.admin.listOrders, async () => {
      const principal = requirePrincipal(request);
      return { status: 200 as const, body: await this.orders.listOrders(principal) };
    });
  }

  @TsRestHandler(apiContract.admin.acceptOrder)
  acceptOrder(@Req() request: RequestWithPrincipal) {
    return tsRestHandler(apiContract.admin.acceptOrder, async ({ params }) => {
      const principal = requirePrincipal(request);
      const result = await this.orders.acceptOrder(principal, params.id);
      if (!result.ok) {
        return { status: result.status, body: { message: result.message } };
      }
      return { status: 200 as const, body: result.value };
    });
  }

  @TsRestHandler(apiContract.admin.serveOrder)
  serveOrder(@Req() request: RequestWithPrincipal) {
    return tsRestHandler(apiContract.admin.serveOrder, async ({ params }) => {
      const principal = requirePrincipal(request);
      const result = await this.orders.serveOrder(principal, params.id);
      if (!result.ok) {
        return { status: result.status, body: { message: result.message } };
      }
      return { status: 200 as const, body: result.value };
    });
  }
}
