import { Injectable, Logger } from "@nestjs/common";
import { EgressInfo, EgressStatus } from "livekit-server-sdk";
import { RecordingStatus } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { LiveKitClientsService } from "../livekit/livekit-clients.service";
import { RECORDING_IN_PROGRESS_STATUSES } from "./recordings.service";

// Filet de sécurité seulement pour les enregistrements encore "en cours" ; ne
// rattrape pas deux fois le même si le cron et un webhook se chevauchent.
const STUCK_THRESHOLD_MS = 10 * 60 * 1000;

// Miroir de EgressStatus (protocole LiveKit, reçu via webhook egress_started/
// egress_updated) vers notre propre état applicatif — permet au frontend de
// distinguer "démarrage demandé" / "capture active" / "finalisation en cours"
// au lieu d'un unique état "en cours" opaque.
const EGRESS_STATUS_TO_RECORDING_STATUS: Partial<Record<EgressStatus, RecordingStatus>> = {
  [EgressStatus.EGRESS_STARTING]: RecordingStatus.STARTING,
  [EgressStatus.EGRESS_ACTIVE]: RecordingStatus.ACTIVE,
  [EgressStatus.EGRESS_ENDING]: RecordingStatus.ENDING,
};

// Room Composite (ancien mode) ou Web (mode actuel, voir RecordingsService.start())
// avec des fileOutputs = notre enregistrement. Toute autre combinaison (stream/
// segments, ou un futur restreaming ajouté plus tard) ne doit jamais créer/mettre
// à jour une ligne Recording (leçon #1 de l'audit livestreamv3 : confondre egress
// d'enregistrement et egress de diffusion avait produit de faux échecs et de
// fausses lignes Recording).
export function isRecordingEgress(egress: EgressInfo): boolean {
  return (
    (egress.request.case === "roomComposite" || egress.request.case === "web") &&
    (egress.request.value.fileOutputs?.length ?? 0) > 0
  );
}

@Injectable()
export class EgressReconciliationService {
  private readonly logger = new Logger(EgressReconciliationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly livekitClients: LiveKitClientsService
  ) {}

  async reconcileRecording(egress: EgressInfo) {
    if (!isRecordingEgress(egress)) return;

    const existing = await this.prisma.recording.findFirst({
      where: { egressId: egress.egressId },
    });
    if (!existing) return;

    if (egress.status === EgressStatus.EGRESS_COMPLETE) {
      const file = egress.fileResults[0];
      const s3Key = file?.filename ?? "";
      const filename = s3Key.split("/").pop() ?? s3Key;
      const size = file?.size ? BigInt(file.size.toString()) : null;
      const duration = file?.duration ? Math.round(Number(file.duration) / 1_000_000_000) : null;

      await this.prisma.recording.update({
        where: { id: existing.id },
        data: { s3Key, filename, size, duration, status: RecordingStatus.READY },
      });
      this.logger.log(`Recording READY : ${filename}`);
    } else if (
      egress.status === EgressStatus.EGRESS_FAILED ||
      egress.status === EgressStatus.EGRESS_ABORTED
    ) {
      await this.prisma.recording.update({
        where: { id: existing.id },
        data: { status: RecordingStatus.FAILED },
      });
      this.logger.warn(`Recording FAILED : ${egress.egressId} (${egress.error})`);
    } else {
      const mapped = EGRESS_STATUS_TO_RECORDING_STATUS[egress.status];
      // Ne jamais faire régresser un enregistrement déjà finalisé (READY/FAILED)
      // si un webhook STARTING/ACTIVE/ENDING arrive en retard ou dans le désordre.
      if (mapped && RECORDING_IN_PROGRESS_STATUSES.includes(existing.status)) {
        await this.prisma.recording.update({
          where: { id: existing.id },
          data: { status: mapped },
        });
      }
    }
  }

  // Filet de sécurité : si le webhook `egress_ended` n'arrive jamais (Redis/worker
  // egress indisponible un instant, redémarrage réseau...), les Recording restent
  // bloqués "en cours" indéfiniment sans ce rattrapage périodique.
  async reconcileStuckRecordings() {
    const stuck = await this.prisma.recording.findMany({
      where: {
        status: { in: RECORDING_IN_PROGRESS_STATUSES },
        egressId: { not: null },
        startedAt: { lt: new Date(Date.now() - STUCK_THRESHOLD_MS) },
      },
    });

    if (stuck.length === 0) return;

    for (const recording of stuck) {
      try {
        const [egress] = await this.livekitClients.egressClient.listEgress({
          egressId: recording.egressId!,
        });
        if (egress) {
          await this.reconcileRecording(egress);
        } else {
          // Egress introuvable côté LiveKit : ne restera jamais READY, on le
          // marque FAILED plutôt que de le laisser bloqué "en cours" pour toujours.
          await this.prisma.recording.update({
            where: { id: recording.id },
            data: { status: RecordingStatus.FAILED },
          });
        }
      } catch (e) {
        this.logger.warn(`Réconciliation échouée pour ${recording.egressId}: ${e}`);
      }
    }
  }
}
