import * as os from "os";
import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { RecordingStatus } from "@prisma/client";
import Redis from "ioredis";
import { StatusComponentDto, SystemStatusDto, ComponentHealth } from "@webinairev2/shared-types";
import { PrismaService } from "../prisma/prisma.service";
import { LiveKitClientsService } from "../livekit/livekit-clients.service";
import { S3Service } from "../storage/s3.service";
import { WebhookHealthService } from "../webhooks/webhook-health.service";

// Un seul client Redis dédié à ce service (même pattern que
// auth/session-store.service.ts) — c'est le même serveur Redis que celui de
// BullMQ (juste un autre index de DB), un ping suffit à couvrir les deux usages.
@Injectable()
export class StatusService {
  private readonly redis = new Redis(process.env.SESSION_REDIS_URL!, {
    lazyConnect: true,
    // Évite qu'un Redis injoignable ne fasse boucler des tentatives de
    // reconnexion en arrière-plan pour un simple health-check ponctuel.
    retryStrategy: () => null,
  });

  constructor(
    private readonly prisma: PrismaService,
    private readonly livekitClients: LiveKitClientsService,
    private readonly s3: S3Service,
    private readonly webhookHealth: WebhookHealthService,
    private readonly config: ConfigService
  ) {}

  async getStatus(): Promise<SystemStatusDto> {
    const [livekit, egress, ingress, postgresql, redis, minio, storage] = await Promise.all([
      this.checkLiveKit(),
      this.checkEgress(),
      this.checkIngress(),
      this.checkPostgresql(),
      this.checkRedis(),
      this.checkMinio(),
      this.checkStorage(),
    ]);

    const components: StatusComponentDto[] = [
      livekit,
      egress,
      ingress,
      postgresql,
      redis,
      minio,
      storage,
      this.checkWebhook(),
    ];

    return { timestamp: new Date().toISOString(), host: this.hostMetrics(), components };
  }

  // Chronomètre un check et convertit toute exception en composant "down" —
  // un service en échec ne doit jamais faire tomber les autres (Promise.all
  // sur des méthodes qui catchent déjà, pas de Promise.allSettled nécessaire).
  private async timed(
    id: string,
    label: string,
    fn: () => Promise<Omit<StatusComponentDto, "id" | "label" | "latencyMs">>
  ): Promise<StatusComponentDto> {
    const start = Date.now();
    try {
      const result = await fn();
      return { id, label, latencyMs: Date.now() - start, ...result };
    } catch (e) {
      return {
        id,
        label,
        status: "down",
        latencyMs: Date.now() - start,
        error: e instanceof Error ? e.message : "Erreur inconnue",
      };
    }
  }

  private checkLiveKit(): Promise<StatusComponentDto> {
    return this.timed("livekit", "LiveKit SFU", async () => {
      const rooms = await this.livekitClients.roomService.listRooms();
      const participants = rooms.reduce((sum, r) => sum + r.numParticipants, 0);
      return { status: "up" as ComponentHealth, details: { rooms: rooms.length, participants } };
    });
  }

  private checkEgress(): Promise<StatusComponentDto> {
    return this.timed("egress", "Egress", async () => {
      const active = await this.livekitClients.egressClient.listEgress({ active: true });
      // Le plafond appliqué par RecordingsService.assertCapacityAvailable() est
      // affiché ici : un administrateur qui reçoit "capacité atteinte" doit
      // pouvoir vérifier d'un coup d'œil combien de captures tournent vraiment.
      const max = this.config.get<number>("recordings.maxConcurrent")!;
      return {
        status: (active.length >= max ? "degraded" : "up") as ComponentHealth,
        details: { active: active.length, capacity: max },
      };
    });
  }

  private checkIngress(): Promise<StatusComponentDto> {
    return this.timed("ingress", "Ingress", async () => {
      const list = await this.livekitClients.ingressClient.listIngress();
      return { status: "up" as ComponentHealth, details: { configured: list.length } };
    });
  }

  private checkPostgresql(): Promise<StatusComponentDto> {
    return this.timed("postgresql", "PostgreSQL", async () => {
      const rows = await this.prisma.$queryRaw<
        { count: number }[]
      >`SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname = current_database()`;
      return { status: "up" as ComponentHealth, details: { connections: rows[0]?.count ?? 0 } };
    });
  }

  private checkRedis(): Promise<StatusComponentDto> {
    return this.timed("redis", "Redis", async () => {
      if (this.redis.status === "wait" || this.redis.status === "end") {
        await this.redis.connect();
      }
      await this.redis.ping();
      // Un seul appel sans section (retourne tout) plutôt que info("clients",
      // "memory") : les sections multiples ne sont supportées qu'à partir de
      // Redis 7 — le conteneur réellement déployé ici tourne encore en 6.0.16
      // malgré l'image "redis:7-alpine" du compose (jamais recréé depuis),
      // et renvoie "ERR syntax error" sur la syntaxe multi-sections.
      const info = await this.redis.info();
      const connectedClients = Number(/connected_clients:(\d+)/.exec(info)?.[1] ?? 0);
      const usedMemoryBytes = Number(/used_memory:(\d+)/.exec(info)?.[1] ?? 0);
      return {
        status: "up" as ComponentHealth,
        details: { connections: connectedClients, memoryBytes: usedMemoryBytes },
      };
    });
  }

  private checkMinio(): Promise<StatusComponentDto> {
    return this.timed("minio", "MinIO", async () => {
      await this.s3.checkReachable();
      return { status: "up" as ComponentHealth };
    });
  }

  // Un HeadBucket dit "MinIO répond", jamais "il reste de la place" — le tableau
  // resterait donc vert avec un volume plein, alors qu'une saturation fait échouer
  // l'egress À L'ÉCRITURE FINALE : c'est l'enregistrement ENTIER qui est perdu, pas
  // seulement sa fin. D'où ce composant distinct.
  //
  // Ce qui est mesuré : la somme des tailles rapportées par l'egress pour les
  // enregistrements finalisés. C'est ce qui grossit vraiment (~1 Go/h), et c'est
  // exactement l'assiette sur laquelle porte la rétention. Ce n'est PAS l'espace
  // libre réel du volume : MinIO tourne sur un hôte distant (S3_ENDPOINT), le
  // backend n'a aucun moyen de lire son df. Le plafond est donc déclaré
  // (RECORDINGS_QUOTA_GB) et doit être tenu à jour si le volume change.
  private checkStorage(): Promise<StatusComponentDto> {
    return this.timed("storage", "Stockage enregistrements", async () => {
      const quotaBytes = this.config.get<number>("recordings.quotaBytes")!;
      const aggregate = await this.prisma.recording.aggregate({
        _sum: { size: true },
        where: { status: RecordingStatus.READY },
      });
      // BigInt : Number est sûr ici (2^53 octets = 9 Po, hors de portée).
      const usedBytes = Number(aggregate._sum.size ?? 0n);
      const ratio = usedBytes / quotaBytes;

      // 80 % laisse encore de quoi encaisser une journée de cours avant la
      // saturation ; 95 % signifie qu'un seul enregistrement de 2 h peut déjà ne
      // pas tenir, ce qui est un incident, pas un avertissement.
      const status: ComponentHealth = ratio >= 0.95 ? "down" : ratio >= 0.8 ? "degraded" : "up";
      // Une purge automatique ne doit jamais être invisible : si une rétention est
      // active, l'administrateur doit la lire au même endroit que l'occupation.
      const retentionDays = this.config.get<number>("recordings.retentionDays")!;
      return {
        status,
        details: {
          usedBytes,
          quotaBytes,
          usedPercent: Math.round(ratio * 100),
          retentionDays,
        },
      };
    });
  }

  private checkWebhook(): StatusComponentDto {
    const { lastReceivedAt, totalReceived } = this.webhookHealth.getStatus();
    // Événementiel, pas périodique : ne jamais afficher "degraded"/"down" sur
    // la seule absence d'événement depuis le démarrage — ça ne prouve rien
    // (aucune salle active récemment est un état parfaitement normal, pas une
    // panne). Seule une vraie erreur de vérification de signature webhook
    // ferait légitimement échouer ce composant, ce que ce check ne couvre pas
    // ici (voir LiveKitWebhookController, qui rejette déjà ces requêtes en
    // amont). "up" reste donc le statut par défaut, "jamais" étant juste une
    // information, pas un verdict.
    return {
      id: "webhook",
      label: "Webhook LiveKit",
      status: "up" as ComponentHealth,
      details: {
        total: totalReceived,
        lastReceivedAt: lastReceivedAt ? lastReceivedAt.toISOString() : "never",
      },
    };
  }

  private hostMetrics() {
    const total = os.totalmem();
    const free = os.freemem();
    return {
      cpuLoad1m: os.loadavg()[0],
      cpuCount: os.cpus().length,
      memUsedBytes: total - free,
      memTotalBytes: total,
    };
  }
}
