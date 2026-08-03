import type {
  ActivityStatsDto,
  AdminUserDto,
  AssignBreakoutDto,
  AttendanceSessionGroupDto,
  BreakoutRoomDto,
  CreateBreakoutRoomsDto,
  CreatePollDto,
  CreateIngressDto,
  CreateRoomDto,
  CreateUserDto,
  CsvImportSummaryDto,
  EnrollmentCsvSummaryDto,
  DownloadLinkDto,
  EnrollableUserDto,
  EnrollmentDto,
  EnrollUserDto,
  JoinRoomResponseDto,
  MyBreakoutAssignmentDto,
  ParticipantDto,
  PollDto,
  PresentationDto,
  RecordingDto,
  RecordingWithRoomDto,
  RoomDto,
  RoomIngressDto,
  RoomIngressStateDto,
  SetCurrentSlideDto,
  StatsRange,
  SystemStatusDto,
  UpdateRoleDto,
  UpdateRoomSettingsDto,
  UserDto,
  VotePollDto,
  WhiteboardSnapshotDto,
  WhiteboardStateDto,
} from "@webinairev2/shared-types";

export const API_URL = import.meta.env.VITE_API_URL;

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });

  if (!res.ok) {
    // Le backend Nest renvoie {message} sur les erreurs (ValidationPipe, exceptions
    // métier comme l'auto-modification de rôle) — on le remonte plutôt qu'un code HTTP brut.
    const body = await res.json().catch(() => null);
    throw new Error(body?.message || `Requête ${path} échouée (${res.status})`);
  }

  if (res.status === 204) return undefined as T;
  return res.json();
}

export const api = {
  me: () => request<UserDto>("/users/me"),
  listRooms: () => request<RoomDto[]>("/rooms"),
  getRoom: (roomId: string) => request<RoomDto>(`/rooms/${roomId}`),
  createRoom: (dto: CreateRoomDto) =>
    request<RoomDto>("/rooms", { method: "POST", body: JSON.stringify(dto) }),
  joinRoom: (roomId: string) => request<JoinRoomResponseDto>(`/rooms/${roomId}/join`, { method: "POST" }),
  closeRoom: (roomId: string) => request<RoomDto>(`/rooms/${roomId}/close`, { method: "POST" }),
  updateRoomSettings: (roomId: string, dto: UpdateRoomSettingsDto) =>
    request<RoomDto>(`/rooms/${roomId}/settings`, { method: "PATCH", body: JSON.stringify(dto) }),
  deleteRoom: (roomId: string) => request<void>(`/rooms/${roomId}`, { method: "DELETE" }),
  muteParticipant: (roomId: string, identity: string) =>
    request<{ ok: true }>(`/rooms/${roomId}/participants/${encodeURIComponent(identity)}/mute`, { method: "POST" }),
  removeParticipant: (roomId: string, identity: string) =>
    request<{ ok: true }>(`/rooms/${roomId}/participants/${encodeURIComponent(identity)}/remove`, {
      method: "POST",
    }),
  setSpeakerPermission: (roomId: string, identity: string, grant: boolean) =>
    request<{ ok: true }>(`/rooms/${roomId}/participants/${encodeURIComponent(identity)}/speaker`, {
      method: "POST",
      body: JSON.stringify({ grant }),
    }),
  setPresenterPermission: (roomId: string, identity: string, grant: boolean) =>
    request<{ ok: true }>(`/rooms/${roomId}/participants/${encodeURIComponent(identity)}/presenter`, {
      method: "POST",
      body: JSON.stringify({ grant }),
    }),
  muteAllParticipants: (roomId: string) => request<{ ok: true }>(`/rooms/${roomId}/mute-all`, { method: "POST" }),
  muteAllCameras: (roomId: string) =>
    request<{ ok: true }>(`/rooms/${roomId}/mute-all-cameras`, { method: "POST" }),

  listRecordings: (roomId: string) => request<RecordingDto[]>(`/rooms/${roomId}/recordings`),
  startRecording: (roomId: string) =>
    request<RecordingDto>(`/rooms/${roomId}/recordings/start`, { method: "POST" }),
  stopRecording: (roomId: string) =>
    request<RecordingDto>(`/rooms/${roomId}/recordings/stop`, { method: "POST" }),
  getRecordingDownloadLink: (recordingId: string) =>
    request<DownloadLinkDto>(`/recordings/${recordingId}/url`),
  deleteRecording: (roomId: string, recordingId: string) =>
    request<void>(`/rooms/${roomId}/recordings/${recordingId}`, { method: "DELETE" }),
  listAllRecordings: () => request<RecordingWithRoomDto[]>("/recordings"),

  // Diffusion OBS (LiveKit Ingress) — réservé à l'animateur côté API : la
  // réponse contient la clé de flux, donc un droit de publication dans la salle.
  getRoomIngress: (roomId: string) => request<RoomIngressStateDto>(`/rooms/${roomId}/ingress`),
  createRoomIngress: (roomId: string, dto: CreateIngressDto) =>
    request<RoomIngressDto>(`/rooms/${roomId}/ingress`, { method: "POST", body: JSON.stringify(dto) }),
  deleteRoomIngress: (roomId: string) => request<void>(`/rooms/${roomId}/ingress`, { method: "DELETE" }),

  listAttendance: (roomId: string) => request<AttendanceSessionGroupDto[]>(`/rooms/${roomId}/attendance`),
  deleteAttendanceSession: (roomId: string, startedAtMs: number) =>
    request<void>(`/rooms/${roomId}/attendance/sessions/${startedAtMs}`, { method: "DELETE" }),

  listEnrollments: (roomId: string) => request<EnrollmentDto[]>(`/rooms/${roomId}/enrollments`),
  enrollUser: (roomId: string, dto: EnrollUserDto) =>
    request<EnrollmentDto>(`/rooms/${roomId}/enrollments`, { method: "POST", body: JSON.stringify(dto) }),
  unenrollUser: (roomId: string, userId: string) =>
    request<void>(`/rooms/${roomId}/enrollments/${userId}`, { method: "DELETE" }),
  enrollmentsCsvTemplateUrl: (roomId: string) => `${API_URL}/rooms/${roomId}/enrollments/csv-template`,
  async importEnrollmentsCsv(roomId: string, file: File): Promise<EnrollmentCsvSummaryDto> {
    const form = new FormData();
    form.append("file", file);
    // Pas de Content-Type manuel : le navigateur doit fixer la boundary multipart.
    const res = await fetch(`${API_URL}/rooms/${roomId}/enrollments/import-csv`, {
      method: "POST",
      credentials: "include",
      body: form,
    });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      throw new Error(body?.message || `Import échoué (${res.status})`);
    }
    return res.json();
  },
  searchEnrollableUsers: (q: string) =>
    request<EnrollableUserDto[]>(`/users/enrollable?q=${encodeURIComponent(q)}`),

  listUsers: () => request<AdminUserDto[]>("/users"),
  createUser: (dto: CreateUserDto) =>
    request<AdminUserDto>("/users", { method: "POST", body: JSON.stringify(dto) }),
  updateUserRole: (userId: string, dto: UpdateRoleDto) =>
    request<AdminUserDto>(`/users/${userId}/role`, { method: "PATCH", body: JSON.stringify(dto) }),
  setUserActive: (userId: string, active: boolean) =>
    request<AdminUserDto>(`/users/${userId}/active`, { method: "PATCH", body: JSON.stringify({ active }) }),
  deleteUser: (userId: string) => request<void>(`/users/${userId}`, { method: "DELETE" }),
  csvTemplateUrl: `${API_URL}/users/csv-template`,

  getSystemStatus: () => request<SystemStatusDto>("/status"),

  getActivityStats: (range: StatsRange) => request<ActivityStatsDto>(`/stats/activity?range=${range}`),
  async importUsersCsv(file: File): Promise<CsvImportSummaryDto> {
    const form = new FormData();
    form.append("file", file);
    // Pas de Content-Type manuel : le navigateur doit fixer la boundary multipart.
    const res = await fetch(`${API_URL}/users/import-csv`, {
      method: "POST",
      credentials: "include",
      body: form,
    });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      throw new Error(body?.message || `Import échoué (${res.status})`);
    }
    return res.json();
  },

  listBreakoutRooms: (roomId: string) => request<BreakoutRoomDto[]>(`/rooms/${roomId}/breakouts`),
  myBreakoutAssignment: (roomId: string) =>
    request<MyBreakoutAssignmentDto>(`/rooms/${roomId}/breakouts/mine`),
  listRoomParticipants: (roomId: string) =>
    request<ParticipantDto[]>(`/rooms/${roomId}/breakouts/participants`),
  createBreakoutRooms: (roomId: string, dto: CreateBreakoutRoomsDto) =>
    request<BreakoutRoomDto[]>(`/rooms/${roomId}/breakouts`, { method: "POST", body: JSON.stringify(dto) }),
  assignBreakout: (roomId: string, dto: AssignBreakoutDto) =>
    request<{ ok: true }>(`/rooms/${roomId}/breakouts/assign`, { method: "POST", body: JSON.stringify(dto) }),
  closeBreakoutRooms: (roomId: string) =>
    request<{ ok: true }>(`/rooms/${roomId}/breakouts/close`, { method: "POST" }),
  joinBreakoutRoom: (roomId: string, breakoutId: string) =>
    request<JoinRoomResponseDto>(`/rooms/${roomId}/breakouts/${breakoutId}/join`, { method: "POST" }),

  getWhiteboard: (roomId: string) => request<WhiteboardSnapshotDto>(`/rooms/${roomId}/whiteboard`),
  saveWhiteboard: (roomId: string, dto: WhiteboardSnapshotDto) =>
    request<{ ok: true }>(`/rooms/${roomId}/whiteboard`, { method: "PUT", body: JSON.stringify(dto) }),
  getWhiteboardState: (roomId: string) => request<WhiteboardStateDto>(`/rooms/${roomId}/whiteboard/state`),
  setWhiteboardState: (roomId: string, dto: WhiteboardStateDto) =>
    request<{ ok: true }>(`/rooms/${roomId}/whiteboard/state`, { method: "PUT", body: JSON.stringify(dto) }),

  listPolls: (roomId: string) => request<PollDto[]>(`/rooms/${roomId}/polls`),
  createPoll: (roomId: string, dto: CreatePollDto) =>
    request<PollDto>(`/rooms/${roomId}/polls`, { method: "POST", body: JSON.stringify(dto) }),
  openPoll: (roomId: string, pollId: string) =>
    request<{ ok: true }>(`/rooms/${roomId}/polls/${pollId}/open`, { method: "POST" }),
  closePoll: (roomId: string, pollId: string) =>
    request<{ ok: true }>(`/rooms/${roomId}/polls/${pollId}/close`, { method: "POST" }),
  votePoll: (roomId: string, pollId: string, dto: VotePollDto) =>
    request<{ ok: true }>(`/rooms/${roomId}/polls/${pollId}/vote`, { method: "POST", body: JSON.stringify(dto) }),

  listPresentations: (roomId: string) => request<PresentationDto[]>(`/rooms/${roomId}/presentations`),
  getActivePresentation: (roomId: string) =>
    request<PresentationDto | null>(`/rooms/${roomId}/presentations/active`),
  async uploadPresentation(roomId: string, file: File): Promise<PresentationDto> {
    const form = new FormData();
    form.append("file", file);
    // Pas de Content-Type manuel : le navigateur doit fixer la boundary multipart.
    const res = await fetch(`${API_URL}/rooms/${roomId}/presentations`, {
      method: "POST",
      credentials: "include",
      body: form,
    });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      throw new Error(body?.message || `Envoi du fichier échoué (${res.status})`);
    }
    return res.json();
  },
  activatePresentation: (roomId: string, id: string) =>
    request<{ ok: true }>(`/rooms/${roomId}/presentations/${id}/activate`, { method: "POST" }),
  deactivatePresentation: (roomId: string) =>
    request<{ ok: true }>(`/rooms/${roomId}/presentations/deactivate`, { method: "POST" }),
  setCurrentSlide: (roomId: string, id: string, dto: SetCurrentSlideDto) =>
    request<{ ok: true }>(`/rooms/${roomId}/presentations/${id}/current-slide`, {
      method: "PUT",
      body: JSON.stringify(dto),
    }),
};
