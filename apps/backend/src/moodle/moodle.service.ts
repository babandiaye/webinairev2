import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { randomUUID } from "crypto";
import { Prisma, RecordingStatus, Role, Room } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { LiveKitClientsService } from "../livekit/livekit-clients.service";
import { RecordingsService } from "../recordings/recordings.service";
import { UsersService } from "../users/users.service";
import { EnrollmentsService } from "../enrollments/enrollments.service";
import { signDownloadToken } from "../common/download-token.util";
import {
  MoodleRecordingDto,
  MoodleRoomDto,
  MoodleRoomStatusDto,
  MoodleUserSyncDto,
} from "@webinairev2/shared-types";
import { CreateMoodleRoomDto } from "./dto/create-moodle-room.dto";
import { SyncMoodleUserDto } from "./dto/sync-moodle-user.dto";

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
    private readonly users: UsersService,
    private readonly enrollments: EnrollmentsService,
    private readonly config: ConfigService
  ) {}

  async createOrGetRoom(dto: CreateMoodleRoomDto): Promise<MoodleRoomDto> {
    const frontendUrl = this.config.get<string>("frontendUrl")!;
    const toDto = (room: Room): MoodleRoomDto => ({
      roomId: room.id,
      roomName: room.roomName,
      title: room.title,
      status: room.status,
      joinUrl: `${frontendUrl}/rooms/${room.id}`,
    });

    const existing = await this.prisma.room.findUnique({ where: { moodleMeetingId: dto.meetingId } });
    if (existing) return toDto(existing);

    // Un enseignant Moodle peut ne s'être jamais connecté à webinairev2 au moment où
    // Moodle crée l'activité côté serveur (pas de session Keycloak disponible ici) —
    // voir UsersService.createOrGetPendingByEmail pour le mécanisme de placeholder.
    // ensureAtLeastModerator (promotion jamais rétrogradation) garantit qu'il pourra
    // gérer sa salle (enregistrement, modération) sans dépendre d'une promotion
    // manuelle depuis /admin/users.
    const teacher = await this.users.ensureAtLeastModerator(dto.teacherEmail, dto.teacherName);
    const roomName = `webinairev2-moodle-${randomUUID()}`;

    await this.livekitClients.roomService.createRoom({ name: roomName, emptyTimeout: 300 });

    try {
      const room = await this.prisma.room.create({
        data: {
          roomName,
          title: dto.title,
          creatorId: teacher.id,
          moodleCourseId: dto.courseId,
          moodleMeetingId: dto.meetingId,
        },
      });
      return toDto(room);
    } catch (e) {
      // Deux appels concurrents du plugin pour la même activité (retry Moodle,
      // double soumission) passent tous les deux le findUnique ci-dessus avant
      // que le premier n'ait committé : le perdant viole la contrainte unique
      // sur moodleMeetingId. L'idempotence promise par le schéma exige de
      // renvoyer la salle gagnante, pas une 500 au plugin.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        const winner = await this.prisma.room.findUnique({
          where: { moodleMeetingId: dto.meetingId },
        });
        if (winner) return toDto(winner);
      }
      throw e;
    }
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

  // Appelé par le plugin Moodle à chaque affichage de l'activité (view.php) pour
  // signaler le rôle d'inscription au cours (Enseignant, Enseignant non
  // éditeur, Gestionnaire...) — le plugin décide seul de isTeacher, ce backend
  // applique juste la règle "promotion jamais rétrogradation" (voir
  // UsersService.ensureAtLeastModerator). isTeacher=false ne modifie jamais un
  // rôle existant : un MODERATOR/ADMIN par ailleurs inscrit comme simple
  // étudiant sur ce cours ne doit pas être rétrogradé.
  //
  // Inscrit aussi l'utilisateur au cours (Enrollment) quand roomId est fourni —
  // condition d'accès à la salle depuis que les salles Moodle ne sont plus
  // exemptées de la restriction "enrôlés uniquement" (voir RoomsService.list/
  // join). Un enseignant synchronisé ici devient ainsi co-modérateur de la
  // salle (voir EnrollmentsService.canManageRoom), même s'il n'en est pas le
  // créateur (cas d'un enseignant non éditeur ou d'un second enseignant).
  async syncUser(dto: SyncMoodleUserDto): Promise<MoodleUserSyncDto> {
    const user = dto.isTeacher
      ? await this.users.ensureAtLeastModerator(dto.email, dto.name)
      : await this.users.createOrGetPendingByEmail(dto.email, dto.name, Role.VIEWER);

    if (dto.roomId) {
      const room = await this.prisma.room.findUnique({ where: { id: dto.roomId } });
      if (room) await this.enrollments.ensureEnrolled(room.id, user.id, "moodle-sync");
    }

    return { userId: user.id, role: user.role };
  }
}
