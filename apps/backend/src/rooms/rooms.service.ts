import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { Role, Room, RoomStatus, RoomType } from "@prisma/client";
import { TrackSource, TrackType } from "livekit-server-sdk";
import { randomUUID } from "crypto";
import { PrismaService } from "../prisma/prisma.service";
import { LiveKitClientsService } from "../livekit/livekit-clients.service";
import { LiveKitTokenService } from "../livekit/livekit-token.service";
import { JoinRoomResponseDto, RoomDto } from "@webinairev2/shared-types";
import { ConfigService } from "@nestjs/config";
import { SessionUser } from "../auth/session.types";
import { BreakoutRoomsService } from "../breakout-rooms/breakout-rooms.service";
import { PresentationsService } from "../presentations/presentations.service";
import { S3Service } from "../storage/s3.service";
import { EnrollmentsService } from "../enrollments/enrollments.service";

@Injectable()
export class RoomsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly livekitClients: LiveKitClientsService,
    private readonly livekitToken: LiveKitTokenService,
    private readonly config: ConfigService,
    private readonly breakoutRooms: BreakoutRoomsService,
    private readonly presentations: PresentationsService,
    private readonly s3: S3Service,
    private readonly enrollments: EnrollmentsService
  ) {}

  async create(title: string, creator: SessionUser): Promise<RoomDto> {
    const roomName = `webinairev2-${randomUUID()}`;

    // La Room LiveKit est créée à l'avance (pas seulement au premier join) pour
    // pouvoir en fixer les métadonnées et éviter une room "fantôme" créée
    // implicitement par le premier participant qui se connecte.
    await this.livekitClients.roomService.createRoom({ name: roomName, emptyTimeout: 300 });

    const room = await this.prisma.room.create({
      data: { roomName, title, creatorId: creator.id },
    });

    // Le créateur peut toujours gérer sa propre salle, inutile d'interroger les
    // inscriptions ici.
    return this.toDto(room, true);
  }

  // Visibilité par rôle : ADMIN voit tout, les autres voient leurs propres
  // salles + celles où ils sont inscrits (étudiant ou co-modérateur) — sauf les
  // salles liées à Moodle (moodleMeetingId non nul), exemptées de cette
  // restriction pour ne pas casser l'intégration Moodle existante (voir
  // EnrollmentsService et le commentaire du modèle Enrollment).
  async list(user: SessionUser): Promise<RoomDto[]> {
    const where =
      user.role === Role.ADMIN
        ? { type: RoomType.MAIN }
        : {
            type: RoomType.MAIN,
            OR: [
              { moodleMeetingId: { not: null } },
              { creatorId: user.id },
              { enrollments: { some: { userId: user.id } } },
            ],
          };

    const rooms = await this.prisma.room.findMany({
      where,
      orderBy: { createdAt: "desc" },
    });

    const enrolledRoomIds =
      user.role === Role.MODERATOR ? await this.enrollments.enrolledRoomIds(user.id) : null;

    return rooms.map((r) => {
      const canManage =
        user.role === Role.ADMIN ||
        r.creatorId === user.id ||
        (enrolledRoomIds !== null && enrolledRoomIds.has(r.id));
      return this.toDto(r, canManage);
    });
  }

  async findOne(id: string, user: SessionUser): Promise<RoomDto> {
    const room = await this.findOneOrThrow(id);
    return this.toDto(room, await this.enrollments.canManageRoom(room, user));
  }

  async findOneOrThrow(id: string): Promise<Room> {
    const room = await this.prisma.room.findUnique({ where: { id } });
    if (!room) throw new NotFoundException("Salle introuvable");
    return room;
  }

  async join(id: string, user: SessionUser): Promise<JoinRoomResponseDto> {
    const room = await this.findOneOrThrow(id);
    // Un créateur de salle (ex. enseignant Moodle jamais promu manuellement, voir
    // MoodleService.upsertTeacherByEmail) a les droits de modération sur SA salle
    // même si son rôle global reste VIEWER — canManageRoom (EnrollmentsService)
    // applique la même règle que RoomAccessGuard : ADMIN, créateur, ou
    // co-modérateur inscrit (un MODERATOR inscrit sur le cours d'un autre
    // modérateur obtient ici aussi les mêmes droits LiveKit que le créateur).
    const isModerator = await this.enrollments.canManageRoom(room, user);

    if (isModerator) {
      // Un modérateur peut toujours (re)rejoindre, y compris une salle SCHEDULED/
      // ENDED — ça "redémarre" la réunion. createRoom est idempotent (ne fait rien
      // si la salle LiveKit existe déjà), nécessaire car close() la supprime et
      // LiveKit ferme aussi une salle vide au bout de emptyTimeout.
      await this.livekitClients.roomService.createRoom({ name: room.roomName, emptyTimeout: 300 });
      if (room.status === RoomStatus.ENDED) {
        // Une nouvelle session repart d'un tableau blanc vierge — sinon le contenu
        // de la réunion précédente réapparaît telle quelle au redémarrage.
        await this.prisma.whiteboardSnapshot.deleteMany({ where: { roomId: id } });
        await this.prisma.room.update({
          where: { id },
          data: { status: RoomStatus.SCHEDULED, endedAt: null, whiteboardOpen: false },
        });
      }
    } else {
      // Une salle liée à Moodle reste ouverte à tout utilisateur connecté (le
      // plugin mod_webinairev2 actuel ne notifie jamais webinairev2 de qui est
      // inscrit à quel cours Moodle, voir EnrollmentsModule) — seules les salles
      // créées manuellement exigent une inscription explicite.
      if (room.moodleMeetingId === null && !(await this.enrollments.isEnrolled(room.id, user.id))) {
        throw new ForbiddenException("Vous n'êtes pas inscrit à ce cours");
      }
      if (!(await this.hasActiveModerator(room.roomName))) {
        // Un participant ne peut rejoindre que si un modérateur/admin est déjà
        // connecté à la salle (présence vérifiée en direct auprès de LiveKit, pas
        // via le statut en base qui ne reflète que l'historique webhook).
        throw new BadRequestException(
          "La réunion n'a pas encore commencé, en attente d'un modérateur"
        );
      }
    }

    const token = await this.livekitToken.createRoomToken({
      roomName: room.roomName,
      identity: user.id,
      name: user.name,
      role: user.role,
      isModerator,
    });

    return {
      room: this.toDto(room, isModerator),
      livekitUrl: this.config.get<string>("livekit.wsUrlPublic")!,
      token,
    };
  }

  // isModerator est embarqué dans les métadonnées du token LiveKit (voir
  // livekit-token.service.ts) — la présence d'un modérateur se vérifie donc en
  // interrogeant directement les participants connectés, sans dépendre d'un état
  // qu'on aurait à maintenir nous-mêmes en base. On lit isModerator plutôt que
  // `role` : un créateur de salle jamais promu globalement (enseignant Moodle) a
  // isModerator=true avec role="VIEWER", et doit compter comme modérateur présent.
  private async hasActiveModerator(roomName: string): Promise<boolean> {
    try {
      const participants = await this.livekitClients.roomService.listParticipants(roomName);
      return participants.some((p) => {
        try {
          const meta = p.metadata ? JSON.parse(p.metadata) : null;
          return meta?.isModerator === true;
        } catch {
          return false;
        }
      });
    } catch {
      // Salle introuvable côté LiveKit (jamais démarrée, ou fermée) : personne dedans.
      return false;
    }
  }

  async close(id: string): Promise<RoomDto> {
    const room = await this.findOneOrThrow(id);

    try {
      await this.livekitClients.roomService.deleteRoom(room.roomName);
    } catch {
      // Déjà terminée côté LiveKit (ex. tous les participants sont partis) : on
      // continue pour que l'état applicatif reste cohérent malgré tout.
    }

    // Sous-groupes et présentations importées sont propres à cette session
    // (pas un espace permanent) : nettoyés en même temps qu'elle se termine.
    const breakouts = await this.prisma.room.findMany({
      where: { parentRoomId: id, type: RoomType.BREAKOUT },
      select: { id: true },
    });
    for (const roomId of [id, ...breakouts.map((b) => b.id)]) {
      await this.presentations.deleteAllForRoom(roomId);
    }
    await this.breakoutRooms.deleteAll(id);

    const updated = await this.prisma.room.update({
      where: { id },
      data: { status: RoomStatus.ENDED, endedAt: new Date(), currentPresentationId: null },
    });

    // Route déjà gardée par RoomAccessGuard : seul un gestionnaire de la salle
    // (créateur, co-modérateur inscrit, ou admin) atteint ce point.
    return this.toDto(updated, true);
  }

  // Suppression définitive (close() ne fait que clôturer une session, la salle
  // reste redémarrable) — refusée tant que la réunion est en direct pour éviter
  // de couper tout le monde sans préavis explicite (fermez la réunion d'abord).
  async remove(id: string): Promise<void> {
    const room = await this.findOneOrThrow(id);
    if (room.status === RoomStatus.LIVE) {
      throw new BadRequestException("Fermez la réunion avant de la supprimer définitivement");
    }

    const breakouts = await this.prisma.room.findMany({
      where: { parentRoomId: id, type: RoomType.BREAKOUT },
      select: { id: true },
    });
    const allRoomIds = [id, ...breakouts.map((b) => b.id)];

    // Purge des objets S3 (enregistrements + diapositives) avant la suppression
    // en base : la cascade Prisma (onDelete: Cascade) supprime les lignes
    // Recording/Presentation/AttendanceRecord/WhiteboardSnapshot/breakouts, mais
    // jamais les fichiers S3 sous-jacents — sans ce nettoyage explicite ils
    // resteraient orphelins dans MinIO, sans plus aucune trace en base pour les
    // identifier après coup.
    for (const roomId of allRoomIds) {
      await this.presentations.deleteAllForRoom(roomId);

      const recordings = await this.prisma.recording.findMany({
        where: { roomId, s3Key: { not: "" } },
        select: { s3Key: true },
      });
      for (const recording of recordings) {
        await this.s3.deleteObject(recording.s3Key).catch(() => {
          // Objet déjà absent ou MinIO temporairement indisponible : on ne
          // bloque pas la suppression de la salle pour un fichier orphelin.
        });
      }
    }

    await this.prisma.room.delete({ where: { id } });
  }

  // Coupe uniquement le micro (pas la caméra) : c'est le cas d'usage modérateur
  // le plus courant (bruit de fond) — le participant reste visible et peut se
  // réactiver lui-même, contrairement à removeParticipant qui le déconnecte.
  async muteParticipant(id: string, identity: string): Promise<void> {
    const room = await this.findOneOrThrow(id);
    const participant = await this.livekitClients.roomService.getParticipant(room.roomName, identity);
    // source === MICROPHONE (pas seulement type === AUDIO) : voir le même
    // correctif dans muteAllParticipants ci-dessous (piste SCREEN_SHARE_AUDIO
    // sinon potentiellement coupée à la place du micro).
    const audioTrack = participant.tracks.find((t) => t.type === TrackType.AUDIO && t.source === TrackSource.MICROPHONE);
    if (!audioTrack) return;
    await this.livekitClients.roomService.mutePublishedTrack(room.roomName, identity, audioTrack.sid, true);
  }

  async removeParticipant(id: string, identity: string): Promise<void> {
    const room = await this.findOneOrThrow(id);
    await this.livekitClients.roomService.removeParticipant(room.roomName, identity);
  }

  // Un participant (rôle VIEWER, canPublish=false à l'émission du token — voir
  // livekit-token.service.ts) ne peut ni parler/activer sa caméra ni partager son
  // écran tant qu'un modérateur ne le lui a pas explicitement accordé (comme sur
  // BigBlueButton). updateParticipant remplace l'intégralité de l'objet de
  // permission côté LiveKit (pas un merge) — on relit donc systématiquement les
  // canPublishSources actuels avant de n'en modifier que le sous-ensemble ciblé,
  // pour ne jamais écraser une autorisation accordée séparément (ex. présentateur
  // en même temps qu'orateur).
  private async updatePublishSources(
    roomId: string,
    identity: string,
    sources: TrackSource[],
    grant: boolean
  ): Promise<void> {
    const room = await this.findOneOrThrow(roomId);
    const participant = await this.livekitClients.roomService.getParticipant(room.roomName, identity);
    const current = new Set(participant.permission?.canPublishSources ?? []);
    for (const source of sources) {
      if (grant) current.add(source);
      else current.delete(source);
    }
    const canPublishSources = Array.from(current);

    await this.livekitClients.roomService.updateParticipant(room.roomName, identity, undefined, {
      canSubscribe: true,
      canPublishData: true,
      canPublish: canPublishSources.length > 0,
      canPublishSources,
    });
  }

  // "Autoriser la parole" — typiquement en réponse à une main levée. Micro et
  // caméra ensemble : une fois la parole donnée, le participant n'est plus en
  // simple écoute, comme un intervenant "non présentateur" sur BBB.
  async setSpeakerPermission(roomId: string, identity: string, grant: boolean): Promise<void> {
    await this.updatePublishSources(roomId, identity, [TrackSource.MICROPHONE, TrackSource.CAMERA], grant);
  }

  // "Nommer présentateur" — partage d'écran uniquement, indépendant du droit de
  // parole (on peut être présentateur sans avoir la parole, et inversement).
  async setPresenterPermission(roomId: string, identity: string, grant: boolean): Promise<void> {
    await this.updatePublishSources(
      roomId,
      identity,
      [TrackSource.SCREEN_SHARE, TrackSource.SCREEN_SHARE_AUDIO],
      grant
    );
  }

  // Coupe le micro de tous les participants non-modérateurs déjà en train de
  // publier de l'audio — ne touche pas à leur autorisation de parole (ils
  // peuvent se réactiver eux-mêmes), contrairement à setSpeakerPermission(false)
  // qui la leur retirerait complètement.
  async muteAllParticipants(roomId: string): Promise<void> {
    const room = await this.findOneOrThrow(roomId);
    const participants = await this.livekitClients.roomService.listParticipants(room.roomName);

    for (const participant of participants) {
      let isModerator = false;
      try {
        isModerator = participant.metadata ? JSON.parse(participant.metadata).isModerator === true : false;
      } catch {
        // metadata malformée ignorée — traité comme non-modérateur
      }
      if (isModerator) continue;

      // source === MICROPHONE (pas seulement type === AUDIO) : un participant qui
      // partage son écran avec le son système publie aussi une piste AUDIO
      // (SCREEN_SHARE_AUDIO) — sans ce filtre, "couper tous les micros" pouvait
      // couper cette piste-là au lieu du micro selon l'ordre du tableau.
      const audioTrack = participant.tracks.find(
        (t) => t.type === TrackType.AUDIO && t.source === TrackSource.MICROPHONE && !t.muted
      );
      if (!audioTrack) continue;
      await this.livekitClients.roomService.mutePublishedTrack(
        room.roomName,
        participant.identity,
        audioTrack.sid,
        true
      );
    }
  }

  private toDto(room: Room, canManage: boolean): RoomDto {
    return {
      id: room.id,
      roomName: room.roomName,
      title: room.title,
      type: room.type,
      parentRoomId: room.parentRoomId,
      status: room.status,
      creatorId: room.creatorId,
      startedAt: room.startedAt?.toISOString() ?? null,
      endedAt: room.endedAt?.toISOString() ?? null,
      canManage,
    };
  }
}
