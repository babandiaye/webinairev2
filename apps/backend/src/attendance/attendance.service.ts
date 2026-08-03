import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AttendanceRecord } from "@prisma/client";
import {
  AttendanceDto,
  AttendanceSessionGroupDto,
  INGRESS_IDENTITY_PREFIX,
} from "@webinairev2/shared-types";

// L'egress Web (voir livekit-token.service.ts createRecorderToken) se connecte
// aussi à la Room comme un participant LiveKit — jamais un vrai utilisateur, ne
// doit jamais apparaître dans la liste de présence.
const EGRESS_RECORDER_PREFIX = "egress-recorder-";

// Même raisonnement pour la diffusion OBS (voir IngressService) : le flux entre
// dans la salle comme un participant, mais compter « Diffusion OBS » comme
// présent pendant 2 h fausserait la feuille de présence du cours.
const SYSTEM_IDENTITY_PREFIXES = [EGRESS_RECORDER_PREFIX, INGRESS_IDENTITY_PREFIX];

function isSystemIdentity(identity: string): boolean {
  return SYSTEM_IDENTITY_PREFIXES.some((prefix) => identity.startsWith(prefix));
}

@Injectable()
export class AttendanceService {
  constructor(private readonly prisma: PrismaService) {}

  // Une ligne par connexion réelle, pas par utilisateur — une reconnexion (coupure
  // réseau, rafraîchissement de page) crée une nouvelle ligne, sommée dans list().
  async recordJoin(
    roomName: string,
    identity: string,
    name: string,
    isModerator: boolean,
    joinedAt: Date
  ): Promise<void> {
    if (isSystemIdentity(identity)) return;
    const room = await this.prisma.room.findUnique({ where: { roomName } });
    if (!room) return;

    // room.startedAt est déjà à jour à ce stade : le webhook met la Room à LIVE
    // (et fixe startedAt) avant d'appeler recordJoin, que ce soit via l'événement
    // room_started ou le repli participant_joined. Filet défensif au cas où
    // startedAt serait malgré tout absent (ne devrait pas arriver en pratique).
    const sessionStartedAt = room.startedAt ?? joinedAt;

    await this.prisma.attendanceRecord.create({
      data: { roomId: room.id, identity, name, isModerator, joinedAt, sessionStartedAt },
    });
  }

  async recordLeave(roomName: string, identity: string, leftAt: Date): Promise<void> {
    if (isSystemIdentity(identity)) return;
    const room = await this.prisma.room.findUnique({ where: { roomName } });
    if (!room) return;

    // Referme la connexion ouverte la plus récente pour cette identité — s'il n'y
    // en a aucune (webhook participant_joined manqué), on ignore silencieusement
    // plutôt que de créer une ligne incohérente sans joinedAt réel.
    const open = await this.prisma.attendanceRecord.findFirst({
      where: { roomId: room.id, identity, leftAt: null },
      orderBy: { joinedAt: "desc" },
    });
    if (!open) return;

    await this.prisma.attendanceRecord.update({ where: { id: open.id }, data: { leftAt } });
  }

  // Regroupe la présence par session (un cycle démarrage → fin de la salle,
  // voir sessionStartedAt sur AttendanceRecord) — une Room étant réutilisable,
  // deux réunions distinctes tenues dans la même salle ne doivent jamais
  // apparaître mélangées dans une seule liste. La plus récente en premier.
  async list(roomId: string): Promise<AttendanceSessionGroupDto[]> {
    const room = await this.prisma.room.findUnique({ where: { id: roomId }, select: { title: true } });

    const records = await this.prisma.attendanceRecord.findMany({
      where: { roomId },
      orderBy: { joinedAt: "asc" },
    });

    const bySession = new Map<number, AttendanceRecord[]>();
    for (const record of records) {
      const key = record.sessionStartedAt.getTime();
      const list = bySession.get(key) ?? [];
      list.push(record);
      bySession.set(key, list);
    }

    // Le titre de la salle rend l'identifiant lisible (ex. "TEST-…") plutôt que
    // le seul roomId technique.
    const sessionLabel = room?.title || roomId;

    const groups: AttendanceSessionGroupDto[] = [];
    for (const [sessionStartedAtMs, sessionRecords] of bySession) {
      const allLeft = sessionRecords.every((r) => r.leftAt !== null);
      const endedAt = allLeft
        ? new Date(Math.max(...sessionRecords.map((r) => r.leftAt!.getTime())))
        : null;

      groups.push({
        sessionId: `${sessionLabel}-${sessionStartedAtMs}`,
        startedAt: new Date(sessionStartedAtMs).toISOString(),
        endedAt: endedAt ? endedAt.toISOString() : null,
        participants: this.aggregateParticipants(sessionRecords),
      });
    }

    groups.sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());
    return groups;
  }

  async deleteSession(roomId: string, sessionStartedAtMs: number): Promise<void> {
    await this.prisma.attendanceRecord.deleteMany({
      where: { roomId, sessionStartedAt: new Date(sessionStartedAtMs) },
    });
  }

  private aggregateParticipants(records: AttendanceRecord[]): AttendanceDto[] {
    const byIdentity = new Map<string, AttendanceRecord[]>();
    for (const record of records) {
      const sessions = byIdentity.get(record.identity) ?? [];
      sessions.push(record);
      byIdentity.set(record.identity, sessions);
    }

    const now = Date.now();
    const result: AttendanceDto[] = [];
    for (const [identity, sessions] of byIdentity) {
      const last = sessions[sessions.length - 1];
      // Une connexion encore ouverte (leftAt=null) compte jusqu'à maintenant —
      // le temps de présence affiché progresse tant que la personne est connectée.
      const totalDurationSeconds = sessions.reduce((sum, s) => {
        const end = s.leftAt ? s.leftAt.getTime() : now;
        return sum + Math.max(0, Math.round((end - s.joinedAt.getTime()) / 1000));
      }, 0);

      result.push({
        identity,
        name: last.name,
        isModerator: sessions.some((s) => s.isModerator),
        totalDurationSeconds,
        firstJoinedAt: sessions[0].joinedAt.toISOString(),
        lastLeftAt: last.leftAt ? last.leftAt.toISOString() : null,
        sessions: sessions.map((s) => ({
          joinedAt: s.joinedAt.toISOString(),
          leftAt: s.leftAt ? s.leftAt.toISOString() : null,
        })),
      });
    }

    // Modérateur(s) d'abord, puis par temps de présence décroissant.
    result.sort((a, b) => {
      if (a.isModerator !== b.isModerator) return a.isModerator ? -1 : 1;
      return b.totalDurationSeconds - a.totalDurationSeconds;
    });
    return result;
  }
}
