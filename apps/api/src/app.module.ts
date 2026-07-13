import { Module } from "@nestjs/common";
import { CoreModule } from "./core.module";
import { AuthModule } from "./modules/auth/auth.module";
import { HealthModule } from "./modules/health/health.module";
import { TenancyModule } from "./modules/tenancy/tenancy.module";

// Modular monolith. Next domains (orders, photos, evaluation, coaching, ...)
// mount here; BullMQ processors get their own entrypoint (main.worker.ts)
// reusing the same DI modules.
@Module({
  imports: [CoreModule, HealthModule, AuthModule, TenancyModule],
})
export class AppModule {}
