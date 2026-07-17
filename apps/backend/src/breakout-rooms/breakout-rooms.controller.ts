import { Body, Controller, Get, Param, Post, UseGuards } from "@nestjs/common";
import { SessionAuthGuard } from "../auth/session-auth.guard";
import { RolesGuard } from "../auth/roles.guard";
import { RoomAccessGuard, RequireRoomAccess } from "../rooms/room-access.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import { SessionUser } from "../auth/session.types";
import { BreakoutRoomsService } from "./breakout-rooms.service";
import { CreateBreakoutRoomsDto } from "./dto/create-breakout-rooms.dto";
import { AssignBreakoutDto } from "./dto/assign-breakout.dto";

@Controller("rooms/:roomId/breakouts")
@UseGuards(SessionAuthGuard, RolesGuard, RoomAccessGuard)
export class BreakoutRoomsController {
  constructor(private readonly breakoutRooms: BreakoutRoomsService) {}

  @Get()
  list(@Param("roomId") roomId: string) {
    return this.breakoutRooms.list(roomId);
  }

  @Get("mine")
  mine(@Param("roomId") roomId: string, @CurrentUser() user: SessionUser) {
    return this.breakoutRooms.myAssignment(roomId, user.id);
  }

  @Get("participants")
  @RequireRoomAccess()
  participants(@Param("roomId") roomId: string) {
    return this.breakoutRooms.listParticipants(roomId);
  }

  // RequireRoomAccess seul : voir le commentaire équivalent dans
  // polls.controller.ts (RequireRole en plus créait un cas incohérent pour un
  // créateur de salle rétrogradé après coup).
  @Post()
  @RequireRoomAccess()
  create(@Param("roomId") roomId: string, @Body() dto: CreateBreakoutRoomsDto) {
    return this.breakoutRooms.create(roomId, dto.count);
  }

  @Post("assign")
  @RequireRoomAccess()
  async assign(@Param("roomId") roomId: string, @Body() dto: AssignBreakoutDto) {
    await this.breakoutRooms.assign(roomId, dto.assignments);
    return { ok: true };
  }

  @Post("close")
  @RequireRoomAccess()
  async close(@Param("roomId") roomId: string) {
    await this.breakoutRooms.closeAll(roomId);
    return { ok: true };
  }

  @Post(":breakoutId/join")
  join(
    @Param("roomId") roomId: string,
    @Param("breakoutId") breakoutId: string,
    @CurrentUser() user: SessionUser
  ) {
    return this.breakoutRooms.join(roomId, breakoutId, user);
  }
}
