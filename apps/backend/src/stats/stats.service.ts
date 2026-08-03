import { Injectable } from "@nestjs/common";
import {
  ActivityPointDto,
  ActivityStatsDto,
  StatsBucket,
  StatsRange,
} from "@webinairev2/shared-types";
import { PrismaService } from "../prisma/prisma.service";

/**
 * Combien de points, et de quelle granularité, pour chaque plage.
 *
 * L'année est regroupée par MOIS et non par jour : 365 barres dans un graphe de
 * 280 px de large ne sont pas lisibles, et les trois séries pèseraient plus de
 * mille points pour un tableau de bord rechargé en continu. Douze barres
 * mensuelles répondent à la question que pose cette plage — « comment
 * l'activité a-t-elle évolué sur l'année » — que le détail journalier noierait.
 */
const RANGE_SPEC: Record<StatsRange, { bucket: StatsBucket; count: number }> = {
  week: { bucket: "day", count: 7 },
  month: { bucket: "day", count: 30 },
  year: { bucket: "month", count: 12 },
};

interface RawPoint {
  date: string;
  value: number;
}

@Injectable()
export class StatsService {
  constructor(private readonly prisma: PrismaService) {}

  async getActivity(range: StatsRange): Promise<ActivityStatsDto> {
    const { bucket, count } = RANGE_SPEC[range];
    // Fenêtre glissante en UTC — vérifié que la session Postgres tourne aussi en
    // UTC (SHOW TIMEZONE), donc date_trunc côté SQL et le zero-fill côté JS
    // retombent sur les mêmes clés de date sans décalage de fuseau.
    const from = new Date();
    if (bucket === "month") {
      // setUTCDate(1) AVANT de reculer les mois : en partant d'un 31, reculer
      // d'abord ferait déborder sur le mois suivant (31 septembre = 1er octobre).
      from.setUTCDate(1);
      from.setUTCMonth(from.getUTCMonth() - (count - 1));
    } else {
      from.setUTCDate(from.getUTCDate() - (count - 1));
    }
    from.setUTCHours(0, 0, 0, 0);

    const [rooms, sessions, recordingDurationSeconds] = await Promise.all([
      this.roomsCreatedPerBucket(from, bucket),
      this.sessionsPerBucket(from, bucket),
      this.recordingDurationPerBucket(from, bucket),
    ]);

    return {
      range,
      bucket,
      rooms: this.zeroFill(rooms, from, count, bucket),
      sessions: this.zeroFill(sessions, from, count, bucket),
      recordingDurationSeconds: this.zeroFill(recordingDurationSeconds, from, count, bucket),
    };
  }

  // `${bucket}::text` et non une concaténation de chaîne : la valeur reste un
  // paramètre lié ($1), jamais du SQL construit. Le cast lève l'ambiguïté entre
  // les surcharges date_trunc(text, timestamp) et date_trunc(text, interval),
  // que Postgres ne saurait pas trancher sur un paramètre non typé.
  private roomsCreatedPerBucket(from: Date, bucket: StatsBucket): Promise<RawPoint[]> {
    return this.prisma.$queryRaw<RawPoint[]>`
      SELECT to_char(date_trunc(${bucket}::text, "createdAt"), 'YYYY-MM-DD') AS date, count(*)::int AS value
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
  private sessionsPerBucket(from: Date, bucket: StatsBucket): Promise<RawPoint[]> {
    return this.prisma.$queryRaw<RawPoint[]>`
      SELECT to_char(date_trunc(${bucket}::text, s."sessionStartedAt"), 'YYYY-MM-DD') AS date, count(*)::int AS value
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

  private recordingDurationPerBucket(from: Date, bucket: StatsBucket): Promise<RawPoint[]> {
    return this.prisma.$queryRaw<RawPoint[]>`
      SELECT to_char(date_trunc(${bucket}::text, "createdAt"), 'YYYY-MM-DD') AS date, COALESCE(sum(duration), 0)::int AS value
      FROM recordings
      WHERE status = 'READY' AND "createdAt" >= ${from}
      GROUP BY 1
      ORDER BY 1
    `;
  }

  // Les périodes sans activité n'apparaissent pas dans le résultat SQL (GROUP BY
  // n'émet rien pour un jour ou un mois vide) — un graphe a besoin d'un axe
  // continu avec des barres à 0, pas de trous silencieux.
  private zeroFill(
    points: RawPoint[],
    from: Date,
    count: number,
    bucket: StatsBucket
  ): ActivityPointDto[] {
    const byDate = new Map(points.map((p) => [p.date, Number(p.value)]));
    const result: ActivityPointDto[] = [];
    for (let i = 0; i < count; i++) {
      const d = new Date(from);
      if (bucket === "month") {
        d.setUTCMonth(d.getUTCMonth() + i);
      } else {
        d.setUTCDate(d.getUTCDate() + i);
      }
      const key = d.toISOString().slice(0, 10);
      result.push({ date: key, value: byDate.get(key) ?? 0 });
    }
    return result;
  }
}
