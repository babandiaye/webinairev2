import type { EgressJoinDto, PresentationDto, WhiteboardSnapshotDto, WhiteboardStateDto } from "@webinairev2/shared-types";
import { API_URL } from "./client";

// Client dédié à la page de rendu d'enregistrement (/egress-view/:id), ouverte
// par le Chrome headless de LiveKit Web Egress — pas de cookie de session
// possible (aucun login Keycloak interactif dans ce contexte), donc le token
// signé transmis dans l'URL est relayé en query string sur chaque appel.
async function request<T>(path: string, token: string): Promise<T> {
  const separator = path.includes("?") ? "&" : "?";
  const res = await fetch(`${API_URL}${path}${separator}token=${encodeURIComponent(token)}`);
  if (!res.ok) throw new Error(`Requête ${path} échouée (${res.status})`);
  return res.json();
}

export const egressApi = {
  join: (roomId: string, token: string) => request<EgressJoinDto>(`/egress/rooms/${roomId}/join`, token),
  getWhiteboardState: (roomId: string, token: string) =>
    request<WhiteboardStateDto>(`/egress/rooms/${roomId}/whiteboard/state`, token),
  getWhiteboard: (roomId: string, token: string) =>
    request<WhiteboardSnapshotDto>(`/egress/rooms/${roomId}/whiteboard`, token),
  getActivePresentation: (roomId: string, token: string) =>
    request<PresentationDto | null>(`/egress/rooms/${roomId}/presentations/active`, token),
};
