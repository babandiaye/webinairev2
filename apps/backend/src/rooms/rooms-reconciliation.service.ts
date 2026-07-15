import { Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { RoomStatus } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { LiveKitClientsService } from "../livekit/livekit-clients.service";
import { RoomsService } from "./rooms.service";

// Filet de sécurité si le webhook room_finished n'arrive jamais (même risque que
// pour les enregistrements, voir egress-reconciliation.service.ts) : une salle
// reste "en cours" (LIVE) en base indéfiniment alors qu'elle n'existe plus côté
// LiveKit (tout le monde est parti et emptyTimeout est dépassé, ou la salle a été
// supprimée sans que le webhook soit délivré) — sans ce rattrapage périodique, le
// tableau de bord affiche "en cours" pour une salle en réalité fermée.
@Injectable()
export class RoomsReconciliationService {
  private readonly logger = new Logger(RoomsReconciliationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly livekitClients: LiveKitClientsService,
    private readonly roomsService: RoomsService
  ) {}

  @Cron("0 */2 * * * *")
  async run() {
    try {
      await this.reconcileStaleLiveRooms();
    } catch (e) {
      this.logger.error(`Réconciliation périodique des salles échouée: ${e}`);
    }
  }

  async reconcileStaleLiveRooms(): Promise<void> {
    const liveRooms = await this.prisma.room.findMany({
      where: { status: RoomStatus.LIVE },
      select: { id: true, roomName: true },
    });
    if (liveRooms.length === 0) return;

    const activeNames = new Set((await this.livekitClients.roomService.listRooms()).map((r) => r.name));

    for (const room of liveRooms) {
      if (activeNames.has(room.roomName)) continue;
      this.logger.warn(
        `Salle ${room.roomName} marquée "en cours" en base mais absente de LiveKit — clôture rattrapée`
      );
      // Réutilise RoomsService.close() : même nettoyage (breakouts, présentations,
      // passage à ENDED) qu'une fermeture explicite par un modérateur.
      await this.roomsService.close(room.id);
    }
  }
}
