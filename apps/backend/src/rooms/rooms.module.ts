import { Module } from "@nestjs/common";
import { RoomsController } from "./rooms.controller";
import { RoomsService } from "./rooms.service";
import { RoomAccessGuard } from "./room-access.guard";
import { RoomsReconciliationService } from "./rooms-reconciliation.service";
import { LiveKitModule } from "../livekit/livekit.module";
import { BreakoutRoomsModule } from "../breakout-rooms/breakout-rooms.module";
import { PresentationsModule } from "../presentations/presentations.module";
import { StorageModule } from "../storage/storage.module";
import { IngressModule } from "../ingress/ingress.module";

@Module({
  imports: [LiveKitModule, BreakoutRoomsModule, PresentationsModule, StorageModule, IngressModule],
  controllers: [RoomsController],
  providers: [RoomsService, RoomAccessGuard, RoomsReconciliationService],
})
export class RoomsModule {}
