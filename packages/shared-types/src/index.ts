export type Role = "ADMIN" | "MODERATOR" | "VIEWER";

export type RoomType = "MAIN" | "BREAKOUT";

export type RoomStatus = "SCHEDULED" | "LIVE" | "ENDED";

export type RecordingStatus = "STARTING" | "ACTIVE" | "ENDING" | "READY" | "FAILED";

// Topic data-channel LiveKit utilisé à la fois par le backend (push serveur à
// chaque transition de statut, voir EgressReconciliationService) et le
// frontend (useRecordingStatus.ts) — centralisé ici pour que les deux
// extrémités ne puissent pas diverger sur la chaîne de caractères.
export const RECORDING_CONTROL_TOPIC = "recording-control";

export type PollStatus = "DRAFT" | "OPEN" | "CLOSED";

export type PresentationStatus = "UPLOADED" | "CONVERTING" | "READY" | "FAILED";

export interface RoomDto {
  id: string;
  roomName: string;
  title: string;
  type: RoomType;
  parentRoomId: string | null;
  status: RoomStatus;
  creatorId: string;
  startedAt: string | null;
  endedAt: string | null;
  // Calculé côté serveur pour l'utilisateur courant (créateur, admin, ou
  // co-modérateur inscrit) — pilote l'affichage des boutons de gestion
  // (Enregistrements/Présence/Étudiants/Supprimer) côté frontend.
  canManage: boolean;
  // true si la salle a été créée depuis le plugin Moodle (mod_webinairev2) —
  // purement informatif (badge), n'affecte plus les règles de visibilité.
  isMoodle: boolean;
  // Réglages "Session" (panneau Paramètres, visible seulement si canManage) —
  // true = verrouillé (comportement par défaut), voir livekit-token.service.ts.
  micLocked: boolean;
  cameraLocked: boolean;
  // Verrous d'interaction — false par défaut (rien de verrouillé), voir
  // RoomLocksMetadata pour le mode d'application.
  chatLocked: boolean;
  reactionsLocked: boolean;
  participantListLocked: boolean;
}

export interface UpdateRoomSettingsDto {
  micLocked?: boolean;
  cameraLocked?: boolean;
  chatLocked?: boolean;
  reactionsLocked?: boolean;
  participantListLocked?: boolean;
}

/**
 * Verrous d'interaction publiés dans les MÉTADONNÉES de la salle LiveKit par
 * RoomsService.syncRoomMetadata, et relus côté client via
 * RoomEvent.RoomMetadataChanged.
 *
 * Ce canal-là et pas un appel d'API : le changement doit atteindre en direct des
 * participants qui ne rappellent jamais GET /rooms/:id après leur entrée, et les
 * métadonnées de salle sont exactement le mécanisme prévu par LiveKit pour un
 * état partagé à l'échelle de la salle.
 *
 * Contrairement à micLocked/cameraLocked, ces verrous ne correspondent à AUCUNE
 * permission LiveKit : le SFU ne sait pas filtrer un canal de données par sujet.
 * Ils sont donc appliqués par les clients — l'émetteur masque le contrôle, et
 * tous les récepteurs ignorent ce qui arriverait malgré tout d'un
 * non-modérateur. Contourner suppose donc de modifier le navigateur de CHAQUE
 * destinataire, pas seulement le sien.
 */
export interface RoomLocksMetadata {
  chatLocked: boolean;
  reactionsLocked: boolean;
  participantListLocked: boolean;
}

export interface CreateRoomDto {
  title: string;
}

export interface JoinRoomResponseDto {
  room: RoomDto;
  livekitUrl: string;
  token: string;
}

export interface UserDto {
  id: string;
  email: string;
  name: string;
  givenName: string;
  role: Role;
}

// Variante utilisée par la page d'administration (liste/désactivation/suppression) —
// UserDto reste inchangé pour /users/me (reflet de SessionUser, pas de requête
// supplémentaire justifiée juste pour afficher son propre statut/compteur).
export interface AdminUserDto extends UserDto {
  active: boolean;
  // Nombre de salles créées par cet utilisateur — affiché avant une suppression :
  // l'API la refuse tant que ce compteur n'est pas à 0 (contrainte FK Room.creatorId).
  roomCount: number;
}

// keycloakId volontairement absent : un compte créé manuellement n'a pas encore
// de vraie identité Keycloak, il adopte un placeholder "pending:" (même mécanisme
// que MoodleService pour les enseignants) — la première connexion réelle de cet
// email l'associe à cette ligne, voir UserSyncService.syncFromKeycloak.
export interface CreateUserDto {
  email: string;
  name: string;
  role: Role;
}

export interface CsvImportSummaryDto {
  total: number;
  created: number;
  skipped: number;
}

export interface RecordingDto {
  id: string;
  roomId: string;
  filename: string;
  duration: number | null;
  size: string | null; // BigInt sérialisé en string (dépasse Number.MAX_SAFE_INTEGER possible)
  status: RecordingStatus;
  startedAt: string | null;
  createdAt: string;
}

// Variante utilisée par la page d'administration globale (toutes salles
// confondues) — RecordingDto reste inchangé pour la page par salle, qui n'a pas
// besoin de répéter le titre de SA propre salle sur chaque ligne.
export interface RecordingWithRoomDto extends RecordingDto {
  roomTitle: string;
  roomName: string;
}

export interface DownloadLinkDto {
  url: string;
  expiresAt: string;
}

export interface UpdateRoleDto {
  role: Role;
}

export interface BreakoutRoomDto {
  id: string;
  roomName: string;
  title: string;
  status: RoomStatus;
  assignedUserIds: string[];
}

export interface MyBreakoutAssignmentDto {
  breakoutRoomId: string | null;
  title: string | null;
}

export interface ParticipantDto {
  identity: string;
  name: string;
}

export interface CreateBreakoutRoomsDto {
  count: number;
}

export interface AssignBreakoutDto {
  assignments: { userId: string; breakoutRoomId: string | null }[];
}

export interface WhiteboardSnapshotDto {
  sceneData: unknown;
}

export interface WhiteboardStateDto {
  open: boolean;
}

export interface PollOptionDto {
  id: string;
  label: string;
  voteCount: number;
  votedByMe: boolean;
}

export interface PollDto {
  id: string;
  roomId: string;
  question: string;
  status: PollStatus;
  multiple: boolean;
  options: PollOptionDto[];
  createdAt: string;
}

export interface CreatePollDto {
  question: string;
  options: string[];
  multiple?: boolean;
}

export interface VotePollDto {
  optionIds: string[];
}

export interface PresentationSlideDto {
  index: number;
  imageUrl: string;
}

export interface PresentationDto {
  id: string;
  roomId: string;
  filename: string;
  status: PresentationStatus;
  slideCount: number;
  currentSlideIndex: number;
  slides: PresentationSlideDto[];
  createdAt: string;
}

export interface SetCurrentSlideDto {
  slideIndex: number;
}

export interface EgressJoinDto {
  livekitUrl: string;
  token: string;
}

// --- Intégration Moodle (plugin mod_webinairev2, auth par clé API serveur-à-serveur) ---

export interface MoodleRoomDto {
  roomId: string;
  roomName: string;
  title: string;
  status: RoomStatus;
  joinUrl: string;
}

export interface MoodleRoomStatusDto {
  status: RoomStatus;
  title: string;
}

export interface MoodleRecordingDto {
  id: string;
  name: string;
  date: string;
  duration: number | null;
  playUrl: string;
}

export interface MoodleUserSyncDto {
  userId: string;
  role: Role;
}

// --- Liste de présence ---

export interface AttendanceSessionDto {
  joinedAt: string;
  leftAt: string | null; // null = connexion toujours active
}

export interface AttendanceDto {
  identity: string;
  name: string;
  isModerator: boolean;
  totalDurationSeconds: number;
  firstJoinedAt: string;
  lastLeftAt: string | null; // null si encore connecté
  sessions: AttendanceSessionDto[];
}

// Un groupe = une session de la salle (un cycle démarrage → fin), identifié par
// "{roomId}-{sessionStartedAt en ms}" — une Room étant réutilisable (redémarrage
// après clôture), la présence de plusieurs réunions distinctes tenues dans la
// même salle ne doit jamais apparaître mélangée dans une seule liste.
export interface AttendanceSessionGroupDto {
  sessionId: string;
  startedAt: string;
  endedAt: string | null; // null tant qu'au moins un participant est encore connecté
  participants: AttendanceDto[];
}

// --- Statut système (page /admin/status) ---

export type ComponentHealth = "up" | "degraded" | "down";

export interface StatusComponentDto {
  id: string; // "livekit" | "egress" | "ingress" | "postgresql" | "redis" | "minio" | "storage" | "webhook"
  label: string;
  status: ComponentHealth;
  latencyMs?: number;
  details?: Record<string, number | string>;
  error?: string;
}

export interface SystemStatusDto {
  timestamp: string;
  host: { cpuLoad1m: number; cpuCount: number; memUsedBytes: number; memTotalBytes: number };
  components: StatusComponentDto[];
}

// --- Statistiques d'activité (tableau de bord) ---

export type StatsRange = "week" | "month";

export interface ActivityPointDto {
  date: string; // YYYY-MM-DD
  value: number;
}

export interface ActivityStatsDto {
  range: StatsRange;
  rooms: ActivityPointDto[]; // cours (salles MAIN) créés par jour
  sessions: ActivityPointDto[]; // sessions distinctes par jour
  recordingDurationSeconds: ActivityPointDto[]; // secondes enregistrées par jour
}

// --- Inscription aux cours (rôles Modérateur/Participant) ---

export interface EnrollmentDto {
  id: string;
  userId: string;
  name: string;
  email: string;
  role: Role;
  createdAt: string;
}

export interface EnrollUserDto {
  userId: string;
}

// Résultat de recherche pour l'inscription (GET /users/enrollable) — un
// sous-ensemble minimal d'AdminUserDto, accessible aux modérateurs (pas
// seulement aux admins).
export interface EnrollableUserDto {
  id: string;
  name: string;
  email: string;
  role: Role;
}
