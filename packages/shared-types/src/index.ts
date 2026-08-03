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
  // Page d'où l'utilisateur est parti (activité Moodle), où le renvoyer en fin
  // de séance. null pour une salle créée directement sur webinairev2.
  // Vient de la salle, jamais de la barre d'adresse : ce backend sert plusieurs
  // plateformes Moodle, chacune avec son domaine, et aucune liste blanche n'a
  // donc à être configurée au build du frontend.
  returnUrl: string | null;
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

export interface EnrollmentCsvSummaryDto {
  /** Lignes retenues (email valide, doublons du fichier fusionnés). */
  total: number;
  /** Inscriptions nouvellement créées. */
  enrolled: number;
  /** Déjà inscrits — le fichier peut être redéposé sans effet de bord. */
  alreadyEnrolled: number;
  /** Comptes créés en attente de première connexion Keycloak. */
  createdUsers: number;
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

// --- Diffusion OBS (LiveKit Ingress) ---

export type IngressProtocol = "rtmp" | "whip";

/**
 * État du flux entrant, reflet direct de IngressState.Status côté LiveKit.
 * "inactive" = point d'entrée créé mais aucun encodeur connecté (état normal
 * entre la génération des identifiants et le clic « Démarrer le streaming »
 * dans OBS), pas une anomalie.
 */
export type IngressStatus = "inactive" | "buffering" | "publishing" | "error" | "complete";

export interface RoomIngressDto {
  ingressId: string;
  protocol: IngressProtocol;
  /** Serveur RTMP (rtmps://…) ou point d'entrée WHIP (https://…) à coller dans OBS. */
  url: string;
  /** Clé de flux RTMP, ou jeton Bearer WHIP — c'est le SECRET de publication. */
  streamKey: string;
  status: IngressStatus;
  /** Renseigné uniquement en statut "error" (flux non conforme, codec refusé…). */
  error: string | null;
}

/**
 * Réponse de GET /rooms/:id/ingress — enveloppe volontaire plutôt qu'un
 * `RoomIngressDto | null` nu : NestJS répond à un `null` par un corps VIDE (pas
 * la chaîne "null"), que `res.json()` côté client ne sait pas analyser. Le cas
 * « aucune diffusion configurée » est le cas normal, il doit se lire sans
 * dépendre d'une erreur silencieusement avalée.
 */
export interface RoomIngressStateDto {
  ingress: RoomIngressDto | null;
}

export interface CreateIngressDto {
  protocol: IngressProtocol;
}

/**
 * Préfixe d'identité du participant LiveKit créé par un ingress OBS.
 *
 * Partagé backend/frontend parce que les deux extrémités doivent le
 * reconnaître : le backend pour l'exclure de la liste de présence (ce n'est
 * pas quelqu'un), le frontend pour en faire la vidéo principale de la scène.
 * L'identification fine passe par la métadonnée `isIngress` (voir
 * IngressService) ; ce préfixe garantit en plus l'unicité par salle.
 */
export const INGRESS_IDENTITY_PREFIX = "obs-";

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
  // Jeton signé et expirant, avec `inline=1` : le plugin déplie un <video> dans
  // la page Moodle. Pas de lien de téléchargement séparé — les contrôles natifs
  // du lecteur l'offrent déjà (mise en page alignée sur mod_livestream).
  playUrl: string;
}

// Le plugin Moodle pagine côté serveur : une activité de cours peut accumuler
// des dizaines d'enregistrements, et chaque entrée renvoyée coûte deux jetons
// HMAC signés (lecture + téléchargement) qu'il serait inutile d'émettre pour
// des lignes jamais affichées.
export interface MoodleRecordingPageDto {
  recordings: MoodleRecordingDto[];
  total: number;
  page: number;
  perPage: number;
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

export type StatsRange = "week" | "month" | "year";

/**
 * Granularité d'un point de la série.
 *
 * Renvoyée par le serveur plutôt que redérivée du `range` côté client : c'est
 * le serveur qui décide du regroupement (une année en 365 barres journalières
 * serait illisible et inutilement lourde, elle est donc agrégée par mois), et
 * le libellé des points en dépend directement.
 */
export type StatsBucket = "day" | "month";

export interface ActivityPointDto {
  /** YYYY-MM-DD — premier jour de la période pour un regroupement mensuel. */
  date: string;
  value: number;
}

export interface ActivityStatsDto {
  range: StatsRange;
  bucket: StatsBucket;
  rooms: ActivityPointDto[]; // cours (salles MAIN) créés
  sessions: ActivityPointDto[]; // sessions distinctes
  recordingDurationSeconds: ActivityPointDto[]; // secondes enregistrées
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
