import { healthContract } from "@boca/contracts";
import { Controller } from "@nestjs/common";
import { TsRestHandler, tsRestHandler } from "@ts-rest/nest";
import { Public } from "../../common/public.decorator";

@Controller()
export class HealthController {
  @Public()
  @TsRestHandler(healthContract.check)
  check() {
    return tsRestHandler(healthContract.check, async () => ({
      status: 200,
      body: { status: "ok" as const, uptimeSeconds: process.uptime() },
    }));
  }
}
