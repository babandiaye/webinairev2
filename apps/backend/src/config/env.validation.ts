import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  BULLMQ_REDIS_URL: z.string().min(1),
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
