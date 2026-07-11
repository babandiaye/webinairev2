import { Module } from "@nestjs/common";
import { BreakoutRoomsController } from "./breakout-rooms.controller";
import { BreakoutRoomsService } from "./breakout-rooms.service";
import { LiveKitModule } from "../livekit/livekit.module";
import { RoomAccessGuard } from "../rooms/room-access.guard";

@Module({
  imports: [LiveKitModule],
  controllers: [BreakoutRoomsController],
  providers: [BreakoutRoomsService, RoomAccessGuard],
  exports: [BreakoutRoomsService],
})
export class BreakoutRoomsModule {}
