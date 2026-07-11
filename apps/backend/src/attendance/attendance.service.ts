import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AttendanceDto } from "@webinairev2/shared-types";

// L'egress Web (voir livekit-token.service.ts createRecorderToken) se connecte
// aussi à la Room comme un participant LiveKit — jamais un vrai utilisateur, ne
// doit jamais apparaître dans la liste de présence.
const EGRESS_RECORDER_PREFIX = "egress-recorder-";

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
    if (identity.startsWith(EGRESS_RECORDER_PREFIX)) return;
    const room = await this.prisma.room.findUnique({ where: { roomName } });
    if (!room) return;

    await this.prisma.attendanceRecord.create({
      data: { roomId: room.id, identity, name, isModerator, joinedAt },
    });
  }

  async recordLeave(roomName: string, identity: string, leftAt: Date): Promise<void> {
    if (identity.startsWith(EGRESS_RECORDER_PREFIX)) return;
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

  async list(roomId: string): Promise<AttendanceDto[]> {
    const records = await this.prisma.attendanceRecord.findMany({
      where: { roomId },
      orderBy: { joinedAt: "asc" },
    });

    const byIdentity = new Map<string, typeof records>();
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
