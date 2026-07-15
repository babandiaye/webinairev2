import { Module } from "@nestjs/common";
import { RoomsController } from "./rooms.controller";
import { RoomsService } from "./rooms.service";
import { RoomAccessGuard } from "./room-access.guard";
import { RoomsReconciliationService } from "./rooms-reconciliation.service";
import { LiveKitModule } from "../livekit/livekit.module";
import { BreakoutRoomsModule } from "../breakout-rooms/breakout-rooms.module";
import { PresentationsModule } from "../presentations/presentations.module";
import { StorageModule } from "../storage/storage.module";

@Module({
  imports: [LiveKitModule, BreakoutRoomsModule, PresentationsModule, StorageModule],
  controllers: [RoomsController],
  providers: [RoomsService, RoomAccessGuard, RoomsReconciliationService],
})
export class RoomsModule {}
