import { Module } from "@nestjs/common";
import { StorageModule } from "../storage/storage.module";
import { GuestController } from "./guest.controller";
import { GuestService } from "./guest.service";

@Module({
  imports: [StorageModule],
  controllers: [GuestController],
  providers: [GuestService],
})
export class GuestModule {}
