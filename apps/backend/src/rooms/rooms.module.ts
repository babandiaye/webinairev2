import { Module } from "@nestjs/common";
import { RoomsController } from "./rooms.controller";
import { RoomsService } from "./rooms.service";
import { RoomAccessGuard } from "./room-access.guard";
import { LiveKitModule } from "../livekit/livekit.module";
import { BreakoutRoomsModule } from "../breakout-rooms/breakout-rooms.module";
import { PresentationsModule } from "../presentations/presentations.module";

@Module({
  imports: [LiveKitModule, BreakoutRoomsModule, PresentationsModule],
  controllers: [RoomsController],
  providers: [RoomsService, RoomAccessGuard],
})
export class RoomsModule {}
