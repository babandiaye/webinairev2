import { Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { PresentationsService } from "./presentations.service";

@Injectable()
export class PresentationsReconciliationCron {
  private readonly logger = new Logger(PresentationsReconciliationCron.name);

  constructor(private readonly presentations: PresentationsService) {}

  // Même cadence et même rôle que RecordingsReconciliationCron : rattraper les
  // conversions dont le processus a disparu (redémarrage backend en plein
  // pdftoppm), qui resteraient sinon CONVERTING indéfiniment.
  @Cron(CronExpression.EVERY_5_MINUTES)
  async run() {
    try {
      await this.presentations.failStuckConversions();
    } catch (e) {
      this.logger.error(`Réconciliation des présentations échouée: ${e}`);
    }
  }
}
