import { Module } from "@nestjs/common";
import { PresentationsController, PresentationSlidesController } from "./presentations.controller";
import { PresentationsService } from "./presentations.service";
import { PresentationsReconciliationCron } from "./presentations-reconciliation.cron";
import { StorageModule } from "../storage/storage.module";
import { RoomAccessGuard } from "../rooms/room-access.guard";

@Module({
  imports: [StorageModule],
  controllers: [PresentationsController, PresentationSlidesController],
  providers: [PresentationsService, PresentationsReconciliationCron, RoomAccessGuard],
  exports: [PresentationsService],
})
export class PresentationsModule {}
