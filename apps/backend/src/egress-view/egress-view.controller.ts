import { Controller, Get, NotFoundException, Param, UseGuards } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PrismaService } from "../prisma/prisma.service";
import { LiveKitTokenService } from "../livekit/livekit-token.service";
import { WhiteboardService } from "../whiteboard/whiteboard.service";
import { PresentationsService } from "../presentations/presentations.service";
import { EgressTokenGuard } from "./egress-token.guard";
import { EgressJoinDto } from "@webinairev2/shared-types";

// Toutes les routes ici sont destinées au navigateur headless de LiveKit Web
// Egress (voir RecordingsService.start()) — lecture seule, jamais de session
// Keycloak, authentifiées par EgressTokenGuard (token HMAC signé, pas cookie).
@Controller("egress/rooms/:roomId")
@UseGuards(EgressTokenGuard)
export class EgressViewController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly livekitToken: LiveKitTokenService,
    private readonly whiteboard: WhiteboardService,
    private readonly presentations: PresentationsService,
    private readonly config: ConfigService
  ) {}

  @Get("join")
  async join(@Param("roomId") roomId: string): Promise<EgressJoinDto> {
    const room = await this.prisma.room.findUnique({ where: { id: roomId } });
    if (!room) throw new NotFoundException("Salle introuvable");

    const token = await this.livekitToken.createRecorderToken(room.roomName);
    return { livekitUrl: this.config.get<string>("livekit.wsUrlPublic")!, token };
  }

  @Get("whiteboard")
  getWhiteboard(@Param("roomId") roomId: string) {
    return this.whiteboard.get(roomId);
  }

  @Get("whiteboard/state")
  getWhiteboardState(@Param("roomId") roomId: string) {
    return this.whiteboard.getOpenState(roomId);
  }

  @Get("presentations/active")
  getActivePresentation(@Param("roomId") roomId: string) {
    return this.presentations.getActive(roomId);
  }
}
