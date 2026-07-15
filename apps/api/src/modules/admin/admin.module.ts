import { Module } from "@nestjs/common";
import { StorageModule } from "../storage/storage.module";
import { AdminCatalogController } from "./catalog.controller";
import { CatalogService } from "./catalog.service";
import { AdminDishController } from "./dish.controller";
import { DishService } from "./dish.service";
import { AdminMediaController } from "./media.controller";
import { MediaService } from "./media.service";
import { AdminMetricsController } from "./metrics.controller";
import { MetricsService } from "./metrics.service";
import { AdminOrderController } from "./order.controller";
import { OrderService } from "./order.service";

// Real (non-demo) tenant-admin backend: menu, photos, reference sets,
// tolerances, users, settings. All DB writes go through withTenant() so RLS
// fences every query to the caller's tenant.
@Module({
  imports: [StorageModule],
  controllers: [
    AdminCatalogController,
    AdminDishController,
    AdminMediaController,
    AdminMetricsController,
    AdminOrderController,
  ],
  providers: [CatalogService, DishService, MediaService, MetricsService, OrderService],
})
export class AdminModule {}
