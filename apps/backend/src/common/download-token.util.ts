import { createHmac, timingSafeEqual } from "crypto";

interface DownloadTokenPayload {
  resourceId: string;
  exp: number; // epoch seconds
}

// Lien de téléchargement signé HMAC expirant — jamais d'URL/clé S3 exposée
// directement au client (leçon #1 de l'audit livestreamv3 : des enregistrements
// étaient accessibles via une clé S3 devinable sans vérification d'autorisation).
// Réutilisé pour les enregistrements et les images de slides de présentation.
export function signDownloadToken(payload: DownloadTokenPayload, secret: string): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = createHmac("sha256", secret).update(body).digest("base64url");
  return `${body}.${signature}`;
}

export function verifyDownloadToken(token: string, secret: string): DownloadTokenPayload | null {
  const [body, signature] = token.split(".");
  if (!body || !signature) return null;

  const expectedSignature = createHmac("sha256", secret).update(body).digest("base64url");
  const sigBuf = Buffer.from(signature);
  const expectedBuf = Buffer.from(expectedSignature);
  if (sigBuf.length !== expectedBuf.length || !timingSafeEqual(sigBuf, expectedBuf)) {
    return null;
  }

  try {
    const payload: DownloadTokenPayload = JSON.parse(Buffer.from(body, "base64url").toString());
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}
