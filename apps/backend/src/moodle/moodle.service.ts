import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { randomUUID } from "crypto";
import { RecordingStatus, Role } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { LiveKitClientsService } from "../livekit/livekit-clients.service";
import { RecordingsService } from "../recordings/recordings.service";
import { signDownloadToken } from "../common/download-token.util";
import { MoodleRecordingDto, MoodleRoomDto, MoodleRoomStatusDto } from "@webinairev2/shared-types";
import { CreateMoodleRoomDto } from "./dto/create-moodle-room.dto";

// Lien de lecture plus long que le lien de téléchargement "normal" (5 min, voir
// RecordingsService) : la page Moodle peut rester ouverte un moment avant que
// l'utilisateur ne clique "Voir", contrairement à RecordingsPage.tsx qui régénère
// le lien juste avant utilisation.
const MOODLE_PLAY_LINK_TTL_SECONDS = 30 * 60;

@Injectable()
export class MoodleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly livekitClients: LiveKitClientsService,
    private readonly recordings: RecordingsService,
    private readonly config: ConfigService
  ) {}

  // Un enseignant Moodle peut ne s'être jamais connecté à webinairev2 au moment où
  // Moodle crée l'activité côté serveur (pas de session Keycloak disponible ici).
  // On le référence par email avec un keycloakId placeholder distinctif ; sa vraie
  // connexion Keycloak adoptera cette même ligne (voir UserSyncService.syncFromKeycloak)
  // au lieu d'en créer une seconde en conflit sur la contrainte unique email.
  private async upsertTeacherByEmail(email: string, name: string): Promise<{ id: string }> {
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) return existing;
    return this.prisma.user.create({
      data: {
        email,
        name,
        keycloakId: `pending:${randomUUID()}`,
        role: Role.VIEWER,
      },
    });
  }

  async createOrGetRoom(dto: CreateMoodleRoomDto): Promise<MoodleRoomDto> {
    const existing = await this.prisma.room.findUnique({ where: { moodleMeetingId: dto.meetingId } });
    const frontendUrl = this.config.get<string>("frontendUrl")!;

    if (existing) {
      return {
        roomId: existing.id,
        roomName: existing.roomName,
        title: existing.title,
        status: existing.status,
        joinUrl: `${frontendUrl}/rooms/${existing.id}`,
      };
    }

    const teacher = await this.upsertTeacherByEmail(dto.teacherEmail, dto.teacherName);
    const roomName = `webinairev2-moodle-${randomUUID()}`;

    await this.livekitClients.roomService.createRoom({ name: roomName, emptyTimeout: 300 });

    const room = await this.prisma.room.create({
      data: {
        roomName,
        title: dto.title,
        creatorId: teacher.id,
        moodleCourseId: dto.courseId,
        moodleMeetingId: dto.meetingId,
      },
    });

    return {
      roomId: room.id,
      roomName: room.roomName,
      title: room.title,
      status: room.status,
      joinUrl: `${frontendUrl}/rooms/${room.id}`,
    };
  }

  async getStatus(roomId: string): Promise<MoodleRoomStatusDto> {
    const room = await this.prisma.room.findUnique({ where: { id: roomId } });
    if (!room) throw new NotFoundException("Salle introuvable");
    return { status: room.status, title: room.title };
  }

  async listRecordings(roomId: string): Promise<MoodleRecordingDto[]> {
    const room = await this.prisma.room.findUnique({ where: { id: roomId } });
    if (!room) throw new NotFoundException("Salle introuvable");

    const recordings = await this.prisma.recording.findMany({
      where: { roomId, status: RecordingStatus.READY },
      orderBy: { createdAt: "desc" },
    });

    const secret = this.config.get<string>("secrets.downloadLink")!;
    return recordings.map((r) => {
      const exp = Math.floor(Date.now() / 1000) + MOODLE_PLAY_LINK_TTL_SECONDS;
      const token = signDownloadToken({ resourceId: r.id, exp }, secret);
      return {
        id: r.id,
        name: r.filename,
        date: r.createdAt.toISOString(),
        duration: r.duration,
        playUrl: `${this.config.get<string>("frontendUrl")}/api/recordings/download?token=${encodeURIComponent(token)}&inline=1`,
      };
    });
  }

  async deleteRecording(roomId: string, recordingId: string): Promise<void> {
    const room = await this.prisma.room.findUnique({ where: { id: roomId } });
    if (!room) throw new BadRequestException("Salle introuvable");
    await this.recordings.remove(roomId, recordingId);
  }
}
