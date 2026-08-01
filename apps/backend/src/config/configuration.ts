export default () => ({
  port: parseInt(process.env.BACKEND_PORT ?? "3000", 10),
  database: {
    url: process.env.DATABASE_URL!,
  },
  s3: {
    endpoint: process.env.S3_ENDPOINT!,
    accessKey: process.env.S3_ACCESS_KEY!,
    secret: process.env.S3_SECRET!,
    region: process.env.S3_REGION!,
    bucket: process.env.S3_BUCKET!,
  },
  livekit: {
    apiKey: process.env.LIVEKIT_API_KEY!,
    apiSecret: process.env.LIVEKIT_API_SECRET!,
    // wsUrl (interne, ex. ws://livekit_sfu:7880) sert au backend pour parler au SFU
    // via le réseau docker ; wsUrlPublic (ex. wss://preprod-webinairertc.unchk.sn)
    // est la seule URL utilisable par le navigateur du client et doit être renvoyée
    // dans les réponses d'API, jamais l'URL interne.
    wsUrl: process.env.LIVEKIT_WS_URL!,
    wsUrlPublic: process.env.LIVEKIT_WS_URL_PUBLIC ?? process.env.LIVEKIT_WS_URL!,
  },
  keycloak: {
    issuer: process.env.KEYCLOAK_ISSUER!,
    // Client confidentiel PARTAGÉ avec le projet unchk-monitor (pas un client
    // dédié à webinairev2) — voir auth/oidc-client.service.ts pour l'implication
    // (échange de code obligatoirement côté serveur, jamais côté SPA).
    clientId: process.env.KEYCLOAK_CLIENT_ID!,
    clientSecret: process.env.KEYCLOAK_CLIENT_SECRET!,
    redirectUri: process.env.PUBLIC_URL + "/api/auth/callback",
  },
  frontendUrl: process.env.FRONTEND_URL!,
  secrets: {
    webhookHmac: process.env.WEBHOOK_HMAC_SECRET!,
    downloadLink: process.env.DOWNLOAD_LINK_SECRET!,
  },
  moodle: {
    apiKey: process.env.MOODLE_API_KEY!,
  },
  recordings: {
    maxConcurrent: parseInt(process.env.MAX_CONCURRENT_RECORDINGS ?? "3", 10),
    quotaBytes: Math.round(parseFloat(process.env.RECORDINGS_QUOTA_GB ?? "50") * 1024 ** 3),
    retentionDays: parseInt(process.env.RECORDINGS_RETENTION_DAYS ?? "0", 10),
  },
});
