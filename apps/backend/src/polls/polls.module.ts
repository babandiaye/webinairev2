import { Module } from "@nestjs/common";
import { PollsController } from "./polls.controller";
import { PollsService } from "./polls.service";
import { RoomAccessGuard } from "../rooms/room-access.guard";

@Module({
  controllers: [PollsController],
  providers: [PollsService, RoomAccessGuard],
})
export class PollsModule {}
