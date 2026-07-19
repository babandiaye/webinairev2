import { Body, Controller, Delete, Get, HttpCode, Param, Post, UseGuards } from "@nestjs/common";
import { SessionAuthGuard } from "../auth/session-auth.guard";
import { RolesGuard } from "../auth/roles.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import { SessionUser } from "../auth/session.types";
import { RoomAccessGuard, RequireRoomAccess } from "../rooms/room-access.guard";
import { EnrollmentsService } from "./enrollments.service";
import { EnrollUserDto } from "./dto/enroll-user.dto";

// Réservé au créateur de la salle, à un co-modérateur inscrit, ou à un admin
// (RequireRoomAccess + RoomAccessGuard, voir EnrollmentsService.canManageRoom) —
// même patron que attendance.controller.ts.
@Controller("rooms/:roomId/enrollments")
@UseGuards(SessionAuthGuard, RolesGuard, RoomAccessGuard)
export class EnrollmentsController {
  constructor(private readonly enrollments: EnrollmentsService) {}

  @Get()
  @RequireRoomAccess()
  list(@Param("roomId") roomId: string) {
    return this.enrollments.list(roomId);
  }

  @Post()
  @RequireRoomAccess()
  enroll(@Param("roomId") roomId: string, @Body() dto: EnrollUserDto, @CurrentUser() user: SessionUser) {
    return this.enrollments.enroll(roomId, dto.userId, user.id);
  }

  @Delete(":userId")
  @RequireRoomAccess()
  @HttpCode(204)
  unenroll(@Param("roomId") roomId: string, @Param("userId") userId: string): Promise<void> {
    return this.enrollments.unenroll(roomId, userId);
  }
}
