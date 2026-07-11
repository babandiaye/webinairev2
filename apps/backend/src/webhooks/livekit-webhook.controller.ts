import {
  BadRequestException,
  Controller,
  Headers,
  Logger,
  Post,
  RawBodyRequest,
  Req,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Request } from "express";
import { WebhookReceiver } from "livekit-server-sdk";
import { PrismaService } from "../prisma/prisma.service";
import { RoomStatus } from "@prisma/client";
import { LiveKitClientsService } from "../livekit/livekit-clients.service";
import { EgressReconciliationService } from "../recordings/egress-reconciliation.service";
import { RECORDING_IN_PROGRESS_STATUSES } from "../recordings/recordings.service";
import { AttendanceService } from "../attendance/attendance.service";

@Controller("webhooks/livekit")
export class LiveKitWebhookController {
  private readonly logger = new Logger(LiveKitWebhookController.name);
  private readonly receiver: WebhookReceiver;

  constructor(
    private readonly prisma: PrismaService,
    private readonly livekitClients: LiveKitClientsService,
    private readonly egressReconciliation: EgressReconciliationService,
    private readonly attendance: AttendanceService,
    config: ConfigService
  ) {
    this.receiver = new WebhookReceiver(
      config.get<string>("livekit.apiKey")!,
      config.get<string>("livekit.apiSecret")!
    );
  }

  @Post()
  async handle(
    @Req() req: RawBodyRequest<Request>,
    @Headers("authorization") authHeader = ""
  ) {
    // req.rawBody est fourni par Nest (rawBody: true dans NestFactory.create) — le
    // corps brut exact est nécessaire pour vérifier la signature HMAC du webhook.
    // Un body-parser JSON qui re-sérialiserait casserait cette vérification
    // silencieusement (piège spécifique à NestJS, absent de Next.js).
    if (!req.rawBody) {
      throw new BadRequestException("Corps brut manquant pour la vérification du webhook");
    }

    const event = await this.receiver.receive(req.rawBody.toString("utf8"), authHeader);
    this.logger.log(`event: ${event.event}`);

    const roomName = event.room?.name;

    if (event.event === "room_started" && roomName) {
      await this.prisma.room.updateMany({
        where: { roomName, status: { in: [RoomStatus.SCHEDULED, RoomStatus.ENDED] } },
        data: { status: RoomStatus.LIVE, startedAt: new Date() },
      });
    }

    if (event.event === "participant_joined" && roomName) {
      await this.prisma.room.updateMany({
        where: { roomName, status: RoomStatus.SCHEDULED },
        data: { status: RoomStatus.LIVE, startedAt: new Date() },
      });

      if (event.participant) {
        const { identity, name, metadata, joinedAtMs } = event.participant;
        let isModerator = false;
        try {
          isModerator = metadata ? JSON.parse(metadata).isModerator === true : false;
        } catch {
          // metadata malformée ignorée — isModerator reste false
        }
        const joinedAt = joinedAtMs ? new Date(Number(joinedAtMs)) : new Date();
        await this.attendance.recordJoin(roomName, identity, name || identity, isModerator, joinedAt);
      }
    }

    if (event.event === "participant_left" && roomName && event.participant) {
      await this.attendance.recordLeave(roomName, event.participant.identity, new Date());
    }

    if (event.event === "room_finished" && roomName) {
      await this.prisma.room.updateMany({
        where: { roomName, status: RoomStatus.LIVE },
        data: { status: RoomStatus.ENDED, endedAt: new Date() },
      });

      // Garde-fou anti-fuite : le web/room-composite egress n'est PAS lié au
      // cycle de vie de la room. Si l'animateur ferme l'onglet ou perd le réseau
      // sans cliquer sur "Arrêter l'enregistrement", l'egress tournerait
      // indéfiniment (leçon tirée de livestreamv3, cf. #6a2cd78).
      const endedRoom = await this.prisma.room.findUnique({ where: { roomName } });
      if (endedRoom) {
        const active = await this.prisma.recording.findMany({
          where: {
            roomId: endedRoom.id,
            status: { in: RECORDING_IN_PROGRESS_STATUSES },
            egressId: { not: null },
          },
        });
        for (const rec of active) {
          try {
            await this.livekitClients.egressClient.stopEgress(rec.egressId!);
            this.logger.log(`egress arrêté (room_finished): ${rec.egressId}`);
          } catch (e) {
            // Déjà terminé côté LiveKit : la fin sera traitée par egress_ended,
            // ou rattrapée par la réconciliation périodique. On ignore l'erreur.
            this.logger.warn(`stopEgress (room_finished) ignoré: ${rec.egressId} — ${e}`);
          }
        }
      }
    }

    // Les 3 événements egress_* donnent chacun un instantané du statut LiveKit
    // (STARTING/ACTIVE/ENDING/COMPLETE/FAILED/ABORTED) — on les exploite tous
    // pour que l'état de l'enregistrement en base reflète precisément où en est
    // la capture, pas juste "en cours" vs "terminé".
    if (
      (event.event === "egress_started" ||
        event.event === "egress_updated" ||
        event.event === "egress_ended") &&
      event.egressInfo
    ) {
      await this.egressReconciliation.reconcileRecording(event.egressInfo);
    }

    return { ok: true };
  }
}
