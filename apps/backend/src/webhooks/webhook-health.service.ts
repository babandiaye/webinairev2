import { Injectable } from "@nestjs/common";

// État en mémoire volontairement simple (pas de persistance) : les webhooks
// LiveKit sont événementiels, pas périodiques — un compteur/horodatage depuis
// le démarrage du process suffit pour la page de statut (/admin/status), qui
// affiche "dernier reçu il y a Xmin" plutôt qu'un verdict up/down strict.
@Injectable()
export class WebhookHealthService {
  private lastReceivedAt: Date | null = null;
  private totalReceived = 0;

  recordReceived(): void {
    this.lastReceivedAt = new Date();
    this.totalReceived += 1;
  }

  getStatus(): { lastReceivedAt: Date | null; totalReceived: number } {
    return { lastReceivedAt: this.lastReceivedAt, totalReceived: this.totalReceived };
  }
}
