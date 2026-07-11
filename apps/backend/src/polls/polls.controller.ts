import { Body, Controller, Get, Param, Post, UseGuards } from "@nestjs/common";
import { Role } from "@prisma/client";
import { SessionAuthGuard } from "../auth/session-auth.guard";
import { RolesGuard } from "../auth/roles.guard";
import { RequireRole } from "../auth/roles.decorator";
import { RoomAccessGuard, RequireRoomAccess } from "../rooms/room-access.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import { SessionUser } from "../auth/session.types";
import { PollsService } from "./polls.service";
import { CreatePollDto } from "./dto/create-poll.dto";
import { VotePollDto } from "./dto/vote-poll.dto";

@Controller("rooms/:roomId/polls")
@UseGuards(SessionAuthGuard, RolesGuard, RoomAccessGuard)
export class PollsController {
  constructor(private readonly polls: PollsService) {}

  @Get()
  list(@Param("roomId") roomId: string, @CurrentUser() user: SessionUser) {
    return this.polls.list(roomId, user.id);
  }

  @Post()
  @RequireRoomAccess()
  @RequireRole(Role.ADMIN, Role.MODERATOR)
  create(@Param("roomId") roomId: string, @Body() dto: CreatePollDto, @CurrentUser() user: SessionUser) {
    return this.polls.create(roomId, user.id, dto);
  }

  @Post(":pollId/open")
  @RequireRoomAccess()
  async open(@Param("roomId") roomId: string, @Param("pollId") pollId: string) {
    await this.polls.open(roomId, pollId);
    return { ok: true };
  }

  @Post(":pollId/close")
  @RequireRoomAccess()
  async close(@Param("roomId") roomId: string, @Param("pollId") pollId: string) {
    await this.polls.close(roomId, pollId);
    return { ok: true };
  }

  @Post(":pollId/vote")
  async vote(
    @Param("roomId") roomId: string,
    @Param("pollId") pollId: string,
    @Body() dto: VotePollDto,
    @CurrentUser() user: SessionUser
  ) {
    await this.polls.vote(roomId, pollId, user.id, dto.optionIds);
    return { ok: true };
  }
}
