import { Injectable } from "@nestjs/common";
import { ActivityPointDto, ActivityStatsDto, StatsRange } from "@webinairev2/shared-types";
import { PrismaService } from "../prisma/prisma.service";

const RANGE_DAYS: Record<StatsRange, number> = { week: 7, month: 30 };

interface RawPoint {
  date: string;
  value: number;
}

@Injectable()
export class StatsService {
  constructor(private readonly prisma: PrismaService) {}

  async getActivity(range: StatsRange): Promise<ActivityStatsDto> {
    const days = RANGE_DAYS[range];
    // Fenêtre glissante en UTC — vérifié que la session Postgres tourne aussi en
    // UTC (SHOW TIMEZONE), donc date_trunc('day', ...) côté SQL et le zero-fill
    // côté JS retombent sur les mêmes clés de date sans décalage de fuseau.
    const from = new Date();
    from.setUTCDate(from.getUTCDate() - (days - 1));
    from.setUTCHours(0, 0, 0, 0);

    const [rooms, sessions, recordingDurationSeconds] = await Promise.all([
      this.roomsCreatedPerDay(from),
      this.sessionsPerDay(from),
      this.recordingDurationPerDay(from),
    ]);

    return {
      range,
      rooms: this.zeroFill(rooms, from, days),
      sessions: this.zeroFill(sessions, from, days),
      recordingDurationSeconds: this.zeroFill(recordingDurationSeconds, from, days),
    };
  }

  private roomsCreatedPerDay(from: Date): Promise<RawPoint[]> {
    return this.prisma.$queryRaw<RawPoint[]>`
      SELECT to_char(date_trunc('day', "createdAt"), 'YYYY-MM-DD') AS date, count(*)::int AS value
      FROM rooms
      WHERE type = 'MAIN' AND "createdAt" >= ${from}
      GROUP BY 1
      ORDER BY 1
    `;
  }

  // Une "session" = un couple distinct (roomId, sessionStartedAt) dans
  // attendance_records — c'est le seul endroit où le cycle démarrage→fin d'une
  // salle réutilisable est déjà distingué (voir le modèle AttendanceRecord).
  // Jointure sur rooms.type='MAIN' pour ne pas compter les sessions de
  // breakout rooms, qui feraient exploser un seul cours en plusieurs sessions.
  private sessionsPerDay(from: Date): Promise<RawPoint[]> {
    return this.prisma.$queryRaw<RawPoint[]>`
      SELECT to_char(date_trunc('day', s."sessionStartedAt"), 'YYYY-MM-DD') AS date, count(*)::int AS value
      FROM (
        SELECT DISTINCT ar."roomId", ar."sessionStartedAt"
        FROM attendance_records ar
        JOIN rooms r ON r.id = ar."roomId"
        WHERE r.type = 'MAIN' AND ar."sessionStartedAt" >= ${from}
      ) s
      GROUP BY 1
      ORDER BY 1
    `;
  }

  private recordingDurationPerDay(from: Date): Promise<RawPoint[]> {
    return this.prisma.$queryRaw<RawPoint[]>`
      SELECT to_char(date_trunc('day', "createdAt"), 'YYYY-MM-DD') AS date, COALESCE(sum(duration), 0)::int AS value
      FROM recordings
      WHERE status = 'READY' AND "createdAt" >= ${from}
      GROUP BY 1
      ORDER BY 1
    `;
  }

  // Les jours sans activité n'apparaissent pas dans le résultat SQL (GROUP BY
  // n'émet rien pour un jour vide) — un graphe a besoin d'un axe continu avec
  // des barres à 0, pas de trous silencieux.
  private zeroFill(points: RawPoint[], from: Date, days: number): ActivityPointDto[] {
    const byDate = new Map(points.map((p) => [p.date, Number(p.value)]));
    const result: ActivityPointDto[] = [];
    for (let i = 0; i < days; i++) {
      const d = new Date(from);
      d.setUTCDate(d.getUTCDate() + i);
      const key = d.toISOString().slice(0, 10);
      result.push({ date: key, value: byDate.get(key) ?? 0 });
    }
    return result;
  }
}
