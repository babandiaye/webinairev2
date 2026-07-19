import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { AccessToken, TrackSource } from "livekit-server-sdk";
import { Role } from "@prisma/client";

@Injectable()
export class LiveKitTokenService {
  constructor(private readonly config: ConfigService) {}

  async createRoomToken(params: {
    roomName: string;
    identity: string;
    name: string;
    role: Role;
    // Distinct du rôle global de l'utilisateur : un créateur de salle (RoomsService/
    // BreakoutRoomsService calculent creatorId===user.id || role ADMIN/MODERATOR)
    // doit pouvoir publier et modérer SA salle même si son rôle applicatif global
    // n'a jamais été promu (cas d'un enseignant Moodle jamais touché par un admin
    // via /users/:id/role) — voir MoodleService.
    isModerator: boolean;
    // Réglages "Session" de la salle (voir RoomsService.updateSettings) —
    // ignorés si isModerator (un modérateur publie toujours sans restriction).
    // true (verrouillé) reproduit le comportement historique : caméra jamais
    // accordée par défaut, micro à accorder individuellement via
    // setSpeakerPermission.
    micLocked: boolean;
    cameraLocked: boolean;
  }): Promise<string> {
    const { roomName, identity, name, role, isModerator, micLocked, cameraLocked } = params;

    const at = new AccessToken(
      this.config.get<string>("livekit.apiKey")!,
      this.config.get<string>("livekit.apiSecret")!,
      // metadata exposé aux autres participants via Participant.metadata — permet
      // d'afficher le rôle (Présentateur/Modérateur/Participant) dans la liste des
      // participants sans appel API supplémentaire. isModerator reflète les droits
      // LiveKit réels (peut différer de `role` pour un créateur non promu), c'est
      // lui qui doit piloter l'étiquette Modérateur/Participant côté UI.
      { identity, name, ttl: "10h", metadata: JSON.stringify({ role, isModerator }) }
    );

    const sources = [
      ...(!micLocked ? [TrackSource.MICROPHONE] : []),
      ...(!cameraLocked ? [TrackSource.CAMERA] : []),
    ];

    at.addGrant({
      room: roomName,
      roomJoin: true,
      canPublish: isModerator || sources.length > 0,
      // undefined (pas de restriction) pour un modérateur ; pour un participant,
      // seules les sources déverrouillées côté salle sont accordées d'entrée —
      // le reste (ou tout en cas de verrouillage complet) passe par un octroi
      // individuel ponctuel, voir setSpeakerPermission.
      canPublishSources: isModerator ? undefined : sources,
      canSubscribe: true,
      canPublishData: true,
      // Un modérateur peut muter/kicker d'autres participants ; un viewer ne peut
      // agir que sur lui-même (leçon C2 appliquée aussi au niveau des grants LiveKit,
      // pas seulement au niveau du guard applicatif).
      roomAdmin: isModerator,
    });

    return at.toJwt();
  }

  // Identité dédiée au navigateur headless de Web Egress : ne publie rien
  // (aucune caméra/micro), ne fait qu'observer la salle pour que l'enregistrement
  // capture exactement ce que les participants voient (vidéo + tableau blanc/
  // présentation partagés) — `hidden` l'exclut de la grille des autres participants.
  async createRecorderToken(roomName: string): Promise<string> {
    const at = new AccessToken(
      this.config.get<string>("livekit.apiKey")!,
      this.config.get<string>("livekit.apiSecret")!,
      { identity: `egress-recorder-${roomName}`, name: "Enregistrement", ttl: "12h" }
    );

    at.addGrant({
      room: roomName,
      roomJoin: true,
      canPublish: false,
      canSubscribe: true,
      canPublishData: false,
      hidden: true,
    });

    return at.toJwt();
  }
}
