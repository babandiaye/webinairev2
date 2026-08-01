import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Room, RoomStatus, RoomType } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { LiveKitClientsService } from "../livekit/livekit-clients.service";
import { LiveKitTokenService } from "../livekit/livekit-token.service";
import { SessionUser } from "../auth/session.types";
import { EnrollmentsService } from "../enrollments/enrollments.service";
import {
  BreakoutRoomDto,
  JoinRoomResponseDto,
  MyBreakoutAssignmentDto,
  ParticipantDto,
  RoomDto,
} from "@webinairev2/shared-types";

@Injectable()
export class BreakoutRoomsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly livekitClients: LiveKitClientsService,
    private readonly livekitToken: LiveKitTokenService,
    private readonly config: ConfigService,
    private readonly enrollments: EnrollmentsService
  ) {}

  private async findParentOrThrow(parentId: string): Promise<Room> {
    const parent = await this.prisma.room.findUnique({ where: { id: parentId } });
    if (!parent) throw new NotFoundException("Salle introuvable");
    if (parent.type !== RoomType.MAIN) {
      throw new BadRequestException("Seule une salle principale peut avoir des sous-salles");
    }
    return parent;
  }

  async create(parentId: string, count: number): Promise<BreakoutRoomDto[]> {
    const parent = await this.findParentOrThrow(parentId);
    const existingCount = await this.prisma.room.count({ where: { parentRoomId: parentId } });

    const created: Room[] = [];
    for (let i = 1; i <= count; i++) {
      const n = existingCount + i;
      const roomName = `${parent.roomName}-breakout-${n}`;
      await this.livekitClients.roomService.createRoom({ name: roomName, emptyTimeout: 300 });
      const room = await this.prisma.room.create({
        data: {
          roomName,
          title: `${parent.title} — Groupe ${n}`,
          type: RoomType.BREAKOUT,
          parentRoomId: parentId,
          creatorId: parent.creatorId,
        },
      });
      created.push(room);
    }
    return created.map(this.toBreakoutDto);
  }

  async list(parentId: string): Promise<BreakoutRoomDto[]> {
    const rooms = await this.prisma.room.findMany({
      where: { parentRoomId: parentId, type: RoomType.BREAKOUT },
      orderBy: { createdAt: "asc" },
    });
    return rooms.map(this.toBreakoutDto);
  }

  async listParticipants(parentId: string): Promise<ParticipantDto[]> {
    const parent = await this.findParentOrThrow(parentId);
    const participants = await this.livekitClients.roomService.listParticipants(parent.roomName);
    return participants.map((p) => ({ identity: p.identity, name: p.name || p.identity }));
  }

  async assign(parentId: string, assignments: { userId: string; breakoutRoomId: string | null }[]): Promise<void> {
    const breakouts = await this.prisma.room.findMany({
      where: { parentRoomId: parentId, type: RoomType.BREAKOUT },
    });
    const breakoutById = new Map(breakouts.map((b) => [b.id, b]));

    for (const { userId, breakoutRoomId } of assignments) {
      if (breakoutRoomId && !breakoutById.has(breakoutRoomId)) {
        throw new BadRequestException("Salle de sous-groupe invalide");
      }

      // Un utilisateur n'appartient qu'à un seul groupe à la fois : on le retire
      // de toutes les breakouts sœurs avant de l'ajouter (ou pas, si désaffectation).
      for (const b of breakoutById.values()) {
        if (b.assignedUserIds.includes(userId)) {
          const updated = await this.prisma.room.update({
            where: { id: b.id },
            data: { assignedUserIds: b.assignedUserIds.filter((id) => id !== userId) },
          });
          breakoutById.set(b.id, updated);
        }
      }

      if (breakoutRoomId) {
        const target = breakoutById.get(breakoutRoomId)!;
        const updated = await this.prisma.room.update({
          where: { id: breakoutRoomId },
          data: { assignedUserIds: { push: userId } },
        });
        breakoutById.set(breakoutRoomId, updated);
      }
    }
  }

  async myAssignment(parentId: string, userId: string): Promise<MyBreakoutAssignmentDto> {
    const breakout = await this.prisma.room.findFirst({
      where: { parentRoomId: parentId, type: RoomType.BREAKOUT, assignedUserIds: { has: userId } },
    });
    return breakout
      ? { breakoutRoomId: breakout.id, title: breakout.title }
      : { breakoutRoomId: null, title: null };
  }

  async join(parentId: string, breakoutId: string, user: SessionUser): Promise<JoinRoomResponseDto> {
    const breakout = await this.prisma.room.findUnique({ where: { id: breakoutId } });
    if (!breakout || breakout.parentRoomId !== parentId) {
      throw new NotFoundException("Salle de sous-groupe introuvable");
    }
    if (breakout.status === RoomStatus.ENDED) {
      throw new BadRequestException("Cette salle de sous-groupe est terminée");
    }

    const parent = await this.prisma.room.findUnique({ where: { id: parentId } });
    const isAssigned = breakout.assignedUserIds.includes(user.id);
    const isManager = parent !== null && (await this.enrollments.canManageRoom(parent, user));

    // Cœur de la garantie de cloisonnement des breakouts (vérifiée par le jalon 3 du
    // plan) : un participant ne peut rejoindre que le groupe auquel il est affecté,
    // le token LiveKit n'est jamais émis pour un groupe non autorisé.
    if (!isAssigned && !isManager) {
      throw new ForbiddenException("Vous n'êtes pas affecté à cette salle de sous-groupe");
    }

    const token = await this.livekitToken.createRoomToken({
      roomName: breakout.roomName,
      identity: user.id,
      name: user.name,
      role: user.role,
      isModerator: isManager,
      micLocked: breakout.micLocked,
      cameraLocked: breakout.cameraLocked,
    });

    return {
      room: this.toRoomDto(breakout, isManager),
      livekitUrl: this.config.get<string>("livekit.wsUrlPublic")!,
      token,
      // Toujours null : un sous-groupe n'a pas d'activité Moodle propre, et on
      // n'en sort pas vers Moodle mais vers la salle principale. Le retour de
      // fin de séance est porté par la connexion principale (voir RoomPage, qui
      // lit mainConnection.returnUrl et non activeConnection).
      returnUrl: null,
    };
  }

  async closeAll(parentId: string): Promise<void> {
    const breakouts = await this.prisma.room.findMany({
      where: { parentRoomId: parentId, type: RoomType.BREAKOUT, status: { not: RoomStatus.ENDED } },
    });

    for (const b of breakouts) {
      try {
        await this.livekitClients.roomService.deleteRoom(b.roomName);
      } catch {
        // Déjà vide/terminée côté LiveKit — on aligne quand même l'état applicatif.
      }
      await this.prisma.room.update({
        where: { id: b.id },
        data: { status: RoomStatus.ENDED, endedAt: new Date() },
      });
    }
  }

  // Appelé quand la salle principale est terminée pour tout le monde : les
  // sous-groupes n'ont pas d'existence propre au-delà de la session qui les a
  // créés, donc suppression complète des lignes (pas juste ENDED comme
  // closeAll(), qui sert au cas plus doux où un modérateur clôt seulement la
  // période de sous-groupes sans terminer la réunion). Exception : un
  // sous-groupe qui porte un enregistrement n'est jamais supprimé
  // silencieusement (cascaderait sur sa ligne Recording) — on le termine
  // seulement, comme closeAll().
  async deleteAll(parentId: string): Promise<void> {
    const breakouts = await this.prisma.room.findMany({
      where: { parentRoomId: parentId, type: RoomType.BREAKOUT },
      include: { recordings: { select: { id: true }, take: 1 } },
    });

    for (const b of breakouts) {
      try {
        await this.livekitClients.roomService.deleteRoom(b.roomName);
      } catch {
        // Déjà vide/terminée côté LiveKit.
      }

      if (b.recordings.length > 0) {
        await this.prisma.room.update({
          where: { id: b.id },
          data: { status: RoomStatus.ENDED, endedAt: new Date() },
        });
      } else {
        await this.prisma.room.delete({ where: { id: b.id } });
      }
    }
  }

  private toBreakoutDto(room: Room): BreakoutRoomDto {
    return {
      id: room.id,
      roomName: room.roomName,
      title: room.title,
      status: room.status,
      assignedUserIds: room.assignedUserIds,
    };
  }

  private toRoomDto(room: Room, canManage: boolean): RoomDto {
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
      isMoodle: room.moodleMeetingId !== null,
      micLocked: room.micLocked,
      cameraLocked: room.cameraLocked,
      chatLocked: room.chatLocked,
      reactionsLocked: room.reactionsLocked,
      participantListLocked: room.participantListLocked,
    };
  }
}
