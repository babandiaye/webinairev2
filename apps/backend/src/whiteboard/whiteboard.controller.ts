import { Body, Controller, Get, Param, Put, UseGuards } from "@nestjs/common";
import { SessionAuthGuard } from "../auth/session-auth.guard";
import { RolesGuard } from "../auth/roles.guard";
import { RoomAccessGuard, RequireRoomAccess, RequireRoomView } from "../rooms/room-access.guard";
import { WhiteboardService } from "./whiteboard.service";
import { SaveWhiteboardDto } from "./dto/save-whiteboard.dto";
import { SetWhiteboardStateDto } from "./dto/set-whiteboard-state.dto";

// Lecture ouverte à tous les participants authentifiés de la salle (ils voient le
// tableau du modérateur), mais seul le créateur de la salle ou un admin peut
// dessiner/effacer ou ouvrir-fermer la session (RequireRoomAccess) — appliqué
// aussi bien côté UI (Excalidraw en viewModeEnabled) que côté API, pour ne pas
// dépendre uniquement du client.
@Controller("rooms/:roomId/whiteboard")
@UseGuards(SessionAuthGuard, RolesGuard, RoomAccessGuard)
export class WhiteboardController {
  constructor(private readonly whiteboard: WhiteboardService) {}

  @Get()
  @RequireRoomView()
  get(@Param("roomId") roomId: string) {
    return this.whiteboard.get(roomId);
  }

  @Put()
  @RequireRoomAccess()
  async save(@Param("roomId") roomId: string, @Body() dto: SaveWhiteboardDto) {
    await this.whiteboard.save(roomId, dto.sceneData);
    return { ok: true };
  }

  // Session partagée : ouvert/fermé pour tout le monde en même temps, pas un
  // simple état d'affichage local — sinon les participants ne voient jamais le
  // tableau blanc apparaître quand le modérateur l'ouvre.
  @Get("state")
  @RequireRoomView()
  getState(@Param("roomId") roomId: string) {
    return this.whiteboard.getOpenState(roomId);
  }

  @Put("state")
  @RequireRoomAccess()
  async setState(@Param("roomId") roomId: string, @Body() dto: SetWhiteboardStateDto) {
    await this.whiteboard.setOpenState(roomId, dto.open);
    return { ok: true };
  }
}
