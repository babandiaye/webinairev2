import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  S3_ENDPOINT: z.string().min(1),
  S3_ACCESS_KEY: z.string().min(1),
  S3_SECRET: z.string().min(1),
  S3_REGION: z.string().min(1),
  S3_BUCKET: z.string().min(1),
  LIVEKIT_API_KEY: z.string().min(1),
  LIVEKIT_API_SECRET: z.string().min(1),
  LIVEKIT_WS_URL: z.string().min(1),
  LIVEKIT_WS_URL_PUBLIC: z.string().min(1).optional(),
  KEYCLOAK_ISSUER: z.string().url(),
  KEYCLOAK_CLIENT_ID: z.string().min(1),
  KEYCLOAK_CLIENT_SECRET: z.string().min(1),
  PUBLIC_URL: z.string().url(),
  FRONTEND_URL: z.string().url(),
  SESSION_SECRET: z.string().min(16),
  SESSION_REDIS_URL: z.string().min(1),
  WEBHOOK_HMAC_SECRET: z.string().min(16),
  DOWNLOAD_LINK_SECRET: z.string().min(16),
  MOODLE_API_KEY: z.string().min(16),
  BACKEND_PORT: z.coerce.number().default(3000),
  // Chaque enregistrement est un Chrome headless complet côté Egress (Web Egress,
  // shm_size 1 Go) : la capacité réelle du nœud se compte en unités, pas en
  // dizaines. Défaut volontairement bas — mieux vaut refuser un 4e enregistrement
  // avec un message clair que d'en faire échouer trois déjà en cours.
  MAX_CONCURRENT_RECORDINGS: z.coerce.number().int().positive().default(3),
  // Budget de stockage alloué aux enregistrements, en Go. Sert uniquement à
  // alerter (page Statut) : MinIO est sur un hôte distant, le backend ne peut pas
  // lire l'espace libre réel de son volume — c'est donc un plafond déclaré, à
  // tenir à jour si le volume change.
  RECORDINGS_QUOTA_GB: z.coerce.number().positive().default(50),
  // Durée de conservation d'un enregistrement finalisé, en jours. 0 = aucune
  // purge automatique, et c'est le défaut délibéré : un enregistrement est
  // souvent la seule trace d'un cours, rien ne doit être détruit sans une
  // décision explicite de l'établissement.
  RECORDINGS_RETENTION_DAYS: z.coerce.number().int().min(0).default(0),
  NODE_ENV: z.string().default("development"),
});

export type EnvConfig = z.infer<typeof envSchema>;

// Fail-fast : on refuse de démarrer si une variable requise manque, plutôt que de
// laisser une valeur undefined se propager silencieusement (ex. secret HMAC vide).
export function validateEnv(config: Record<string, unknown>): EnvConfig {
  const parsed = envSchema.safeParse(config);
  if (!parsed.success) {
    throw new Error(
      `Configuration invalide :\n${parsed.error.issues
        .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
        .join("\n")}`
    );
  }
  return parsed.data;
}
