import { Module, type OnApplicationShutdown } from "@nestjs/common";
import { PlatformController } from "./platform.controller";
import { PlatformService } from "./platform.service";
import { PlatformAuthGuard } from "./platform-auth.guard";
import { destroyPlatformPool } from "./platform-db";

// Super-admin (Bitup) surface: tenant onboarding + domains + branding, on the
// dedicated boca_platform DB role. Auth is a separate JWT type (PlatformAuthGuard);
// endpoints stay 503 until PLATFORM_DATABASE_URL is configured.
@Module({
  controllers: [PlatformController],
  providers: [PlatformService, PlatformAuthGuard],
})
export class PlatformModule implements OnApplicationShutdown {
  async onApplicationShutdown(): Promise<void> {
    await destroyPlatformPool();
  }
}
