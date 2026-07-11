import { Injectable, Logger } from "@nestjs/common";
import { Cron, CronExpression } from "@nestjs/schedule";
import { EgressReconciliationService } from "./egress-reconciliation.service";

@Injectable()
export class RecordingsReconciliationCron {
  private readonly logger = new Logger(RecordingsReconciliationCron.name);

  constructor(private readonly reconciliation: EgressReconciliationService) {}

  // Filet de sécurité si le webhook egress_ended n'arrive jamais (voir
  // egress-reconciliation.service.ts) — toutes les 5 minutes, largement
  // suffisant vu le seuil de 10 min avant qu'un enregistrement soit considéré
  // "bloqué".
  @Cron(CronExpression.EVERY_5_MINUTES)
  async run() {
    try {
      await this.reconciliation.reconcileStuckRecordings();
    } catch (e) {
      this.logger.error(`Réconciliation périodique échouée: ${e}`);
    }
  }
}
