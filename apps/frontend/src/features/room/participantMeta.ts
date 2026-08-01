/**
 * Les métadonnées d'un participant LiveKit sont une chaîne JSON libre remplie
 * par notre backend à l'émission du jeton (voir livekit-token.service.ts) :
 * `{ isModerator, role }`. Elles peuvent être absentes (participant connecté
 * avec un jeton d'une version antérieure) ou malformées — dans le doute on ne
 * promeut jamais quelqu'un modérateur.
 */
export function isModeratorMetadata(metadata: string | undefined): boolean {
  if (!metadata) return false;
  try {
    return JSON.parse(metadata)?.isModerator === true;
  } catch {
    return false;
  }
}
