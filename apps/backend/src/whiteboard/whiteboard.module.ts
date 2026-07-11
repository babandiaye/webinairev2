import { Module } from "@nestjs/common";
import { WhiteboardController } from "./whiteboard.controller";
import { WhiteboardService } from "./whiteboard.service";
import { RoomAccessGuard } from "../rooms/room-access.guard";

@Module({
  controllers: [WhiteboardController],
  providers: [WhiteboardService, RoomAccessGuard],
  exports: [WhiteboardService],
})
export class WhiteboardModule {}
