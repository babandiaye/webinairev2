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

/**
 * Participant créé par une diffusion OBS (voir IngressService côté backend) :
 * ce n'est pas quelqu'un dans la salle mais une source de contenu de
 * l'animateur. Sa vidéo passe au premier plan de la scène, et les actions de
 * modération individuelles (donner la parole, nommer présentateur) n'ont aucun
 * sens sur lui.
 */
export function isIngressMetadata(metadata: string | undefined): boolean {
  if (!metadata) return false;
  try {
    return JSON.parse(metadata)?.isIngress === true;
  } catch {
    return false;
  }
}
