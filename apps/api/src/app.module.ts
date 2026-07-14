import { Module } from "@nestjs/common";
import { CoreModule } from "./core.module";
import { AdminModule } from "./modules/admin/admin.module";
import { AuthModule } from "./modules/auth/auth.module";
import { EvaluationModule } from "./modules/evaluation/evaluation.module";
import { GuestModule } from "./modules/guest/guest.module";
import { HealthModule } from "./modules/health/health.module";
import { ReferencesModule } from "./modules/references/references.module";
import { StorageModule } from "./modules/storage/storage.module";
import { TenancyModule } from "./modules/tenancy/tenancy.module";

// Modular monolith. Next domains (orders, coaching, ...) mount here; BullMQ
// processors run from their own entrypoint (main.worker.ts) reusing the same
// DI modules — the ai-score worker starts ONLY there.
@Module({
  imports: [
    CoreModule,
    HealthModule,
    AuthModule,
    TenancyModule,
    StorageModule,
    ReferencesModule,
    EvaluationModule,
    GuestModule,
    AdminModule,
  ],
})
export class AppModule {}
