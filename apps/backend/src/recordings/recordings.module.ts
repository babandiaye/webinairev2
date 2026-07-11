import { Module } from "@nestjs/common";
import { RoomRecordingsController, RecordingsController } from "./recordings.controller";
import { RecordingsService } from "./recordings.service";
import { EgressReconciliationService } from "./egress-reconciliation.service";
import { RecordingsReconciliationCron } from "./reconciliation.cron";
import { LiveKitModule } from "../livekit/livekit.module";
import { StorageModule } from "../storage/storage.module";
import { RoomAccessGuard } from "../rooms/room-access.guard";

@Module({
  imports: [LiveKitModule, StorageModule],
  controllers: [RoomRecordingsController, RecordingsController],
  providers: [
    RecordingsService,
    EgressReconciliationService,
    RecordingsReconciliationCron,
    RoomAccessGuard,
  ],
  exports: [EgressReconciliationService, RecordingsService],
})
export class RecordingsModule {}
