import { apiContract } from "@boca/contracts";
import { Controller } from "@nestjs/common";
import { TsRestHandler, tsRestHandler } from "@ts-rest/nest";
import { Public } from "../../common/public.decorator";
import { GuestService } from "./guest.service";

@Controller()
export class GuestController {
  constructor(private readonly guest: GuestService) {}

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
}
