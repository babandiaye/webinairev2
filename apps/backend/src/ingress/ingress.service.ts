import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import {
  IngressAudioEncodingPreset,
  IngressAudioOptions,
  IngressInfo,
  IngressInput,
  IngressVideoEncodingPreset,
  IngressVideoOptions,
  TrackSource,
} from "livekit-server-sdk";
import {
  INGRESS_IDENTITY_PREFIX,
  IngressProtocol,
  IngressStatus,
  RoomIngressDto,
} from "@webinairev2/shared-types";
import { LiveKitClientsService } from "../livekit/livekit-clients.service";
import { PrismaService } from "../prisma/prisma.service";

/**
 * Valeurs de l'énumération IngressState.Status côté LiveKit.
 *
 * Recopiées plutôt qu'importées : livekit-server-sdk réexporte le message
 * IngressState mais pas son enum de statut, et @livekit/protocol n'est ici
 * qu'une dépendance transitive — l'importer directement ferait dépendre le
 * backend d'un paquet que son package.json ne déclare pas.
 */
const STATUS_BY_CODE: Record<number, IngressStatus> = {
  0: "inactive",
  1: "buffering",
  2: "publishing",
  3: "error",
  4: "complete",
};

@Injectable()
export class IngressService {
  private readonly logger = new Logger(IngressService.name);

  // PrismaService plutôt que RoomsService pour résoudre roomId → roomName :
  // RoomsService dépend de ce service (nettoyage à la clôture de la salle), et
  // l'inverse créerait une dépendance circulaire entre les deux modules.
  constructor(
    private readonly livekitClients: LiveKitClientsService,
    private readonly prisma: PrismaService
  ) {}

  async get(roomId: string): Promise<RoomIngressDto | null> {
    const roomName = await this.roomNameOrThrow(roomId);
    const [existing] = await this.livekitClients.ingressClient.listIngress({ roomName });
    return existing ? this.toDto(existing) : null;
  }

  /**
   * (Re)crée le point d'entrée OBS de la salle.
   *
   * Un seul ingress par salle à tout moment : les précédents sont supprimés
   * d'abord. Sans ça, changer de protocole ou simplement rouvrir le panneau
   * empilerait des points d'entrée dont les clés de flux resteraient valides
   * indéfiniment — autant de droits de publication dans la salle que personne
   * ne surveille plus.
   */
  async create(roomId: string, protocol: IngressProtocol): Promise<RoomIngressDto> {
    const roomName = await this.roomNameOrThrow(roomId);
    await this.deleteForRoomName(roomName);

    const options = {
      name: roomName,
      roomName,
      // Identité stable et reconnaissable : le backend l'exclut de la liste de
      // présence (ce n'est pas une personne) et le frontend en fait la vidéo
      // principale de la scène — voir INGRESS_IDENTITY_PREFIX.
      participantIdentity: `${INGRESS_IDENTITY_PREFIX}${roomId}`,
      participantName: "Diffusion OBS",
      // isModerator:false — le flux n'a aucun pouvoir de modération ; isIngress
      // exclut ce participant des actions « à tous les participants » (couper
      // les micros/caméras, verrous de session), qui couperaient sinon la
      // diffusion de l'animateur lui-même. Voir RoomsService.
      participantMetadata: JSON.stringify({ isModerator: false, isIngress: true }),
      // La source déclarée décide de la façon dont le frontend voit les pistes
      // (CallStage écoute Camera/Microphone) — laissée implicite, une piste
      // d'ingress peut arriver en source « inconnue » et n'être affichée nulle
      // part alors qu'elle est bien publiée.
      video: new IngressVideoOptions({
        source: TrackSource.CAMERA,
        // Transcodage en simulcast 3 couches pour le RTMP uniquement : c'est ce
        // qui permet à un participant sur réseau faible de recevoir une couche
        // basse plutôt que de saturer. En WHIP le flux est relayé tel quel
        // (voir enableTranscoding ci-dessous), donc aucun préréglage à imposer.
        ...(protocol === "rtmp"
          ? {
              encodingOptions: {
                case: "preset" as const,
                value: IngressVideoEncodingPreset.H264_1080P_30FPS_3_LAYERS,
              },
            }
          : {}),
      }),
      audio: new IngressAudioOptions({
        source: TrackSource.MICROPHONE,
        ...(protocol === "rtmp"
          ? {
              encodingOptions: {
                case: "preset" as const,
                value: IngressAudioEncodingPreset.OPUS_STEREO_96KBPS,
              },
            }
          : {}),
      }),
      // WHIP arrive déjà en WebRTC : le relayer sans transcoder économise 2 à 6
      // cœurs par flux (cf. doc self-hosting) et supprime la latence de
      // réencodage — c'est tout l'intérêt du protocole face au RTMP.
      ...(protocol === "whip" ? { enableTranscoding: false } : {}),
    };

    const info = await this.livekitClients.ingressClient.createIngress(
      protocol === "whip" ? IngressInput.WHIP_INPUT : IngressInput.RTMP_INPUT,
      options
    );
    this.logger.log(`ingress ${protocol} créé pour ${roomName}: ${info.ingressId}`);
    return this.toDto(info);
  }

  async remove(roomId: string): Promise<void> {
    await this.deleteForRoomName(await this.roomNameOrThrow(roomId));
  }

  private async roomNameOrThrow(roomId: string): Promise<string> {
    const room = await this.prisma.room.findUnique({
      where: { id: roomId },
      select: { roomName: true },
    });
    if (!room) throw new NotFoundException("Salle introuvable");
    return room.roomName;
  }

  /**
   * Supprime tous les points d'entrée d'une salle.
   *
   * Appelé aussi à la clôture et à la suppression de la salle (RoomsService) :
   * une clé de flux qui survit à la séance laisse la porte ouverte à une
   * publication dans une salle que l'animateur croit fermée — LiveKit
   * recréerait la room à la première trame reçue.
   */
  async deleteForRoomName(roomName: string): Promise<void> {
    let existing: IngressInfo[];
    try {
      existing = await this.livekitClients.ingressClient.listIngress({ roomName });
    } catch (e) {
      // Service ingress injoignable : on ne bloque pas la clôture de la salle
      // pour autant. Le point d'entrée restant sera écrasé au prochain create().
      this.logger.warn(`listIngress(${roomName}) ignoré — ${e}`);
      return;
    }

    for (const info of existing) {
      try {
        await this.livekitClients.ingressClient.deleteIngress(info.ingressId);
      } catch (e) {
        this.logger.warn(`deleteIngress ignoré: ${info.ingressId} — ${e}`);
      }
    }
  }

  private toDto(info: IngressInfo): RoomIngressDto {
    const status = STATUS_BY_CODE[info.state?.status ?? 0] ?? "inactive";
    return {
      ingressId: info.ingressId,
      protocol: info.inputType === IngressInput.WHIP_INPUT ? "whip" : "rtmp",
      url: info.url,
      streamKey: info.streamKey,
      status,
      // state.error est renseigné en permanence par LiveKit (debug du flux reçu :
      // bitrate, résolution) — on ne le remonte qu'en cas d'erreur réelle, sinon
      // l'interface afficherait un message d'échec sur un flux qui va bien.
      error: status === "error" ? info.state?.error || "Flux refusé par le serveur" : null,
    };
  }
}
