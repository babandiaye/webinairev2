import { BadRequestException, Controller, Delete, Get, HttpCode, Param, UseGuards } from "@nestjs/common";
import { SessionAuthGuard } from "../auth/session-auth.guard";
import { RolesGuard } from "../auth/roles.guard";
import { RoomAccessGuard, RequireRoomAccess } from "../rooms/room-access.guard";
import { AttendanceService } from "./attendance.service";

// Réservé au créateur de la salle ou à un admin (RequireRoomAccess) — le temps de
// présence de chacun est une donnée personnelle, pas quelque chose que les autres
// participants doivent pouvoir consulter (contrairement à la liste des enregistrements).
@Controller("rooms/:roomId/attendance")
@UseGuards(SessionAuthGuard, RolesGuard, RoomAccessGuard)
export class AttendanceController {
  constructor(private readonly attendance: AttendanceService) {}

  @Get()
  @RequireRoomAccess()
  list(@Param("roomId") roomId: string) {
    return this.attendance.list(roomId);
  }

  @Delete("sessions/:startedAtMs")
  @RequireRoomAccess()
  @HttpCode(204)
  deleteSession(
    @Param("roomId") roomId: string,
    @Param("startedAtMs") startedAtMs: string
  ): Promise<void> {
    const ms = Number(startedAtMs);
    if (!Number.isFinite(ms)) throw new BadRequestException("Horodatage de session invalide");
    return this.attendance.deleteSession(roomId, ms);
  }
}
