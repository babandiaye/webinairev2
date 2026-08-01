import { Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { RecordingsService } from "./recordings.service";

@Injectable()
export class RecordingsRetentionCron {
  private readonly logger = new Logger(RecordingsRetentionCron.name);

  constructor(private readonly recordings: RecordingsService) {}

  // Une fois par nuit : la purge est une opération de fond, jamais urgente, et
  // 3h du matin garantit qu'aucun cours n'est en train d'écrire dans MinIO
  // pendant qu'on y supprime des objets.
  // Ne fait rien tant que RECORDINGS_RETENTION_DAYS vaut 0 (défaut) — voir
  // RecordingsService.purgeExpired().
  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async run() {
    try {
      const purged = await this.recordings.purgeExpired();
      if (purged > 0) this.logger.log(`Purge de rétention : ${purged} enregistrement(s) supprimé(s)`);
    } catch (e) {
      this.logger.error(`Purge de rétention échouée: ${e}`);
    }
  }
}
