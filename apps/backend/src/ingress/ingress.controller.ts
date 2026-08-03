import { Body, Controller, Delete, Get, HttpCode, Param, Post, UseGuards } from "@nestjs/common";
import { RoomIngressStateDto } from "@webinairev2/shared-types";
import { SessionAuthGuard } from "../auth/session-auth.guard";
import { RolesGuard } from "../auth/roles.guard";
import { RoomAccessGuard, RequireRoomAccess } from "../rooms/room-access.guard";
import { IngressService } from "./ingress.service";
import { CreateIngressDto } from "./dto/create-ingress.dto";

/**
 * Diffusion depuis un encodeur externe (OBS) vers la salle, en RTMP(S) ou WHIP.
 *
 * @RequireRoomAccess sur les TROIS routes, lecture comprise : la réponse
 * contient la clé de flux, c'est-à-dire un droit de publication dans la salle.
 * Un simple inscrit (RequireRoomView) ne doit pas pouvoir la lire — il pourrait
 * sinon diffuser à la place de l'animateur.
 */
@Controller("rooms/:roomId/ingress")
@UseGuards(SessionAuthGuard, RolesGuard, RoomAccessGuard)
export class IngressController {
  constructor(private readonly ingress: IngressService) {}

  @Get()
  @RequireRoomAccess()
  async get(@Param("roomId") roomId: string): Promise<RoomIngressStateDto> {
    return { ingress: await this.ingress.get(roomId) };
  }

  @Post()
  @RequireRoomAccess()
  create(@Param("roomId") roomId: string, @Body() dto: CreateIngressDto) {
    return this.ingress.create(roomId, dto.protocol);
  }

  @Delete()
  @RequireRoomAccess()
  @HttpCode(204)
  remove(@Param("roomId") roomId: string): Promise<void> {
    return this.ingress.remove(roomId);
  }
}
