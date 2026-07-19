import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { EncodedFileOutput, EncodedFileType, EncodingOptionsPreset } from "livekit-server-sdk";
import { RecordingStatus, RoomStatus } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { LiveKitClientsService } from "../livekit/livekit-clients.service";
import { S3Service } from "../storage/s3.service";
import { SessionUser } from "../auth/session.types";
import { DownloadLinkDto, RecordingDto, RecordingWithRoomDto } from "@webinairev2/shared-types";
import { signDownloadToken } from "../common/download-token.util";
import { RECORDING_IN_PROGRESS_STATUSES } from "./recording-status.constants";
import { EgressReconciliationService } from "./egress-reconciliation.service";
import { EnrollmentsService } from "../enrollments/enrollments.service";

const DOWNLOAD_LINK_TTL_SECONDS = 5 * 60;
// Doit couvrir la durée max réaliste d'une session (le token reste valide tout
// le long, polling whiteboard/présentation inclus) sans excéder ce qui est
// nécessaire — 12h laissait un token valable bien après la fin de tout cours en
// cas de fuite (URL relayée dans les logs nginx/egress, cf. commentaire sur
// egressUrl plus bas).
const EGRESS_TOKEN_TTL_SECONDS = 4 * 60 * 60;

// Fenêtre normale de démarrage (Chrome headless + chargement de la vue + signal
// START_RECORDING) : sous ce seuil, un enregistrement encore STARTING est
// normal, pas la peine d'interroger LiveKit à chaque lecture de la liste.
const STARTING_RECONCILE_THRESHOLD_MS = 60 * 1000;

// Nom de fichier façon BigBlueButton : pas de préfixe applicatif, UUID compacté
// (seul le tiret précédant les 12 derniers caractères est conservé) + horodatage.
function buildRecordingFilepath(roomName: string): string {
  const uuid = roomName.replace(/^webinairev2-/, "");
  const parts = uuid.split("-");
  const compact = parts.length === 5 ? `${parts.slice(0, 4).join("")}-${parts[4]}` : uuid;
  return `recordings/${compact}-${Date.now()}.mp4`;
}

@Injectable()
export class RecordingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly livekitClients: LiveKitClientsService,
    private readonly s3: S3Service,
    private readonly config: ConfigService,
    private readonly reconciliation: EgressReconciliationService,
    private readonly enrollments: EnrollmentsService
  ) {}

  async start(roomId: string): Promise<RecordingDto> {
    const room = await this.prisma.room.findUnique({ where: { id: roomId } });
    if (!room) throw new NotFoundException("Salle introuvable");
    if (room.status !== RoomStatus.LIVE) {
      throw new BadRequestException("La salle doit être en direct pour démarrer un enregistrement");
    }

    const active = await this.prisma.recording.findFirst({
      where: { roomId, status: { in: RECORDING_IN_PROGRESS_STATUSES } },
    });
    if (active) {
      throw new BadRequestException("Un enregistrement est déjà en cours pour cette salle");
    }

    const filepath = buildRecordingFilepath(room.roomName);
    const output = new EncodedFileOutput({
      fileType: EncodedFileType.MP4,
      filepath,
      output: { case: "s3", value: this.s3.buildEgressUploadConfig() },
    });

    // Web Egress (pas Room Composite) : LiveKit ouvre cette URL dans un Chrome
    // headless et enregistre littéralement ce qui s'y affiche — grille vidéo ET
    // tableau blanc/présentation partagés, que Room Composite ne peut pas voir
    // (il ne rend que les pistes média publiées, jamais notre UI React).
    const exp = Math.floor(Date.now() / 1000) + EGRESS_TOKEN_TTL_SECONDS;
    const egressToken = signDownloadToken(
      { resourceId: roomId, exp },
      this.config.get<string>("secrets.downloadLink")!
    );
    // Token dans le FRAGMENT (#), pas en query string : le fragment n'est jamais
    // envoyé au serveur par le navigateur, donc n'apparaît ni dans les logs
    // d'accès nginx ni dans une éventuelle capture réseau côté proxy — seule la
    // requête GET initiale du Chrome headless vers cette URL existe forcément
    // (LiveKit Web Egress ne permet pas d'y joindre un en-tête personnalisé) ;
    // tous les appels API suivants (join, whiteboard, présentation) transmettent
    // le token via l'en-tête X-Egress-Token à la place (voir egressApi.ts).
    const egressUrl = `${this.config.get<string>("frontendUrl")}/egress-view/${roomId}#token=${encodeURIComponent(egressToken)}`;

    const egressInfo = await this.livekitClients.egressClient.startWebEgress(egressUrl, output, {
      encodingOptions: EncodingOptionsPreset.H264_1080P_30,
      // Le Chrome headless doit avoir rejoint la salle LiveKit et fini de rendre
      // la page avant que l'enregistrement ne démarre (sinon on capture un écran
      // de chargement vide) — cf. le console.log("START_RECORDING") côté frontend.
      awaitStartSignal: true,
    });

    const recording = await this.prisma.recording.create({
      data: {
        roomId,
        egressId: egressInfo.egressId,
        status: RecordingStatus.STARTING,
        startedAt: new Date(),
      },
    });

    return this.toDto(recording);
  }

  async stop(roomId: string): Promise<RecordingDto> {
    const active = await this.prisma.recording.findFirst({
      where: { roomId, status: { in: RECORDING_IN_PROGRESS_STATUSES } },
    });
    if (!active?.egressId) {
      throw new BadRequestException("Aucun enregistrement actif pour cette salle");
    }

    await this.livekitClients.egressClient.stopEgress(active.egressId);
    // Mis à jour tout de suite pour une UI réactive — le webhook egress_updated
    // (EGRESS_ENDING) confirmera le même état sous peu, de façon idempotente.
    const updated = await this.prisma.recording.update({
      where: { id: active.id },
      data: { status: RecordingStatus.ENDING },
    });
    return this.toDto(updated);
  }

  async list(roomId: string): Promise<RecordingDto[]> {
    const recordings = await this.prisma.recording.findMany({
      where: { roomId },
      orderBy: { createdAt: "desc" },
    });

    // Auto-réparation : si le webhook egress_active/egress_ended a été perdu
    // (Redis/worker egress indisponible un instant), le cron de secours
    // (reconcileStuckRecordings) ne repasse que toutes les 5 min — trop long
    // pour un participant qui regarde l'écran "va bientôt commencer" se figer.
    // On retente ici, mais jamais avant STARTING_RECONCILE_THRESHOLD_MS (un
    // démarrage normal met déjà plusieurs secondes, pas la peine d'appeler
    // LiveKit à chaque affichage de la liste). Une erreur LiveKit ici ne doit
    // jamais empêcher de renvoyer la liste telle quelle.
    const staleStarting = recordings.filter(
      (r) =>
        r.status === RecordingStatus.STARTING &&
        r.egressId &&
        Date.now() - r.createdAt.getTime() > STARTING_RECONCILE_THRESHOLD_MS
    );
    if (staleStarting.length === 0) {
      return recordings.map((r) => this.toDto(r));
    }

    // Un seul aller-retour de réconciliation par appel (pas de re-vérification
    // récursive du seuil) : si l'egress est encore légitimement STARTING après
    // la tentative, on ne veut pas ré-appeler LiveKit en boucle à chaque lecture.
    await this.reconcileStale(staleStarting.map((r) => r.egressId!));
    const refreshed = await this.prisma.recording.findMany({
      where: { roomId },
      orderBy: { createdAt: "desc" },
    });
    return refreshed.map((r) => this.toDto(r));
  }

  private async reconcileStale(egressIds: string[]): Promise<void> {
    for (const egressId of egressIds) {
      try {
        const [egress] = await this.livekitClients.egressClient.listEgress({ egressId });
        if (egress) await this.reconciliation.reconcileRecording(egress);
      } catch {
        // LiveKit indisponible ou egress introuvable : on retentera à la
        // prochaine lecture (ou le cron de secours prendra le relais) — ne
        // jamais faire échouer l'affichage de la liste pour autant.
      }
    }
  }

  // Toutes salles confondues — page d'administration globale (voir RecordingsController,
  // ADMIN uniquement : list()/RoomRecordingsController couvre déjà l'usage par salle,
  // ouvert au créateur, ce qui suffit hors contexte d'administration).
  async listAll(): Promise<RecordingWithRoomDto[]> {
    const recordings = await this.prisma.recording.findMany({
      orderBy: { createdAt: "desc" },
      include: { room: { select: { title: true, roomName: true } } },
    });
    return recordings.map((r) => ({ ...this.toDto(r), roomTitle: r.room.title, roomName: r.room.roomName }));
  }

  // Jamais d'URL/clé S3 exposée directement — un lien signé HMAC de courte durée,
  // et uniquement après vérification que l'appelant est créateur de la salle ou
  // administrateur (leçon #1 de l'audit livestreamv3).
  async getDownloadLink(recordingId: string, user: SessionUser): Promise<DownloadLinkDto> {
    const recording = await this.prisma.recording.findUnique({
      where: { id: recordingId },
      include: { room: true },
    });
    if (!recording) throw new NotFoundException("Enregistrement introuvable");
    if (recording.status !== RecordingStatus.READY) {
      throw new BadRequestException("Cet enregistrement n'est pas encore disponible");
    }
    if (!(await this.enrollments.canManageRoom(recording.room, user))) {
      throw new ForbiddenException("Vous n'êtes pas autorisé à télécharger cet enregistrement");
    }

    const exp = Math.floor(Date.now() / 1000) + DOWNLOAD_LINK_TTL_SECONDS;
    const token = signDownloadToken(
      { resourceId: recording.id, exp },
      this.config.get<string>("secrets.downloadLink")!
    );

    return {
      url: `/recordings/download?token=${encodeURIComponent(token)}`,
      expiresAt: new Date(exp * 1000).toISOString(),
    };
  }

  async remove(roomId: string, recordingId: string): Promise<void> {
    const recording = await this.prisma.recording.findUnique({ where: { id: recordingId } });
    if (!recording || recording.roomId !== roomId) {
      throw new NotFoundException("Enregistrement introuvable");
    }
    if (RECORDING_IN_PROGRESS_STATUSES.includes(recording.status)) {
      throw new BadRequestException("Arrêtez l'enregistrement avant de le supprimer");
    }

    if (recording.s3Key) {
      await this.s3.deleteObject(recording.s3Key);
    }
    await this.prisma.recording.delete({ where: { id: recordingId } });
  }

  private toDto(recording: {
    id: string;
    roomId: string;
    filename: string;
    duration: number | null;
    size: bigint | null;
    status: RecordingStatus;
    startedAt: Date | null;
    createdAt: Date;
  }): RecordingDto {
    return {
      id: recording.id,
      roomId: recording.roomId,
      filename: recording.filename,
      duration: recording.duration,
      size: recording.size?.toString() ?? null,
      status: recording.status,
      startedAt: recording.startedAt?.toISOString() ?? null,
      createdAt: recording.createdAt.toISOString(),
    };
  }
}
