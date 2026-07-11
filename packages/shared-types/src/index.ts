export type Role = "ADMIN" | "MODERATOR" | "VIEWER";

export type RoomType = "MAIN" | "BREAKOUT";

export type RoomStatus = "SCHEDULED" | "LIVE" | "ENDED";

export type RecordingStatus = "STARTING" | "ACTIVE" | "ENDING" | "READY" | "FAILED";

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
