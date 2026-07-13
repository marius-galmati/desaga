import { Module } from "@nestjs/common";
import { StorageModule } from "../storage/storage.module";
import { ReferencesController } from "./references.controller";
import { ReferencesService } from "./references.service";

@Module({
  imports: [StorageModule],
  controllers: [ReferencesController],
  providers: [ReferencesService],
})
export class ReferencesModule {}
