import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { randomUUID } from "crypto";
import { RecordingStatus, Role } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { LiveKitClientsService } from "../livekit/livekit-clients.service";
import { RecordingsService } from "../recordings/recordings.service";
import { UsersService } from "../users/users.service";
import { EnrollmentsService } from "../enrollments/enrollments.service";
import { signDownloadToken } from "../common/download-token.util";
import {
  MoodleRecordingDto,
  MoodleRecordingPageDto,
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

// Bornes de pagination — le plugin Moodle est le seul appelant, mais la valeur
// vient d'un réglage d'administration côté Moodle : elle est traitée comme une
// entrée non fiable (un perPage démesuré ferait signer autant de jetons HMAC).
const RECORDINGS_DEFAULT_PER_PAGE = 10;
const RECORDINGS_MAX_PER_PAGE = 100;

// L'URL de retour finit dans un window.location du navigateur : on n'y laisse
// passer que du http(s). L'appel est authentifié par clé API (donc de confiance),
// mais cette clé est partagée entre toutes les plateformes Moodle branchées sur
// ce backend — une valeur aberrante venue de l'une d'elles ne doit pas devenir
// un javascript: exécuté chez les utilisateurs d'une autre.
function sanitizeReturnUrl(raw?: string): string | null {
  if (!raw) return null;
  try {
    const parsed = new URL(raw);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? raw : null;
  } catch {
    return null;
  }
}

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

  // Crée TOUJOURS une salle neuve, identifiée par le cuid généré ici.
  //
  // Ne cherche JAMAIS une salle existante par moodleMeetingId : cet identifiant
  // est l'id de la ligne `webinairev2`, unique au sein d'UNE plateforme Moodle
  // seulement. Ce backend en sert plusieurs — l'activité n°1 de disi-dev et
  // l'activité n°1 d'un autre Moodle portaient le même identifiant et se
  // retrouvaient rattachées à la même salle. livestreamv3 a subi exactement cet
  // incident le 27/07/2026 et a supprimé la même logique.
  //
  // L'idempotence — ne pas recréer une salle pour une activité qui en a déjà
  // une — est garantie CÔTÉ PLUGIN : webinairev2_add_instance est le seul
  // appelant, et il ne s'exécute qu'à la création de l'activité. L'affichage de
  // l'activité (view.php) ne crée jamais rien.
  async createRoom(dto: CreateMoodleRoomDto): Promise<MoodleRoomDto> {
    const frontendUrl = this.config.get<string>("frontendUrl")!;

    // Un enseignant Moodle peut ne s'être jamais connecté à webinairev2 au moment où
    // Moodle crée l'activité côté serveur (pas de session Keycloak disponible ici) —
    // voir UsersService.createOrGetPendingByEmail pour le mécanisme de placeholder.
    // ensureAtLeastModerator (promotion jamais rétrogradation) garantit qu'il pourra
    // gérer sa salle (enregistrement, modération) sans dépendre d'une promotion
    // manuelle depuis /admin/users.
    const teacher = await this.users.ensureAtLeastModerator(dto.teacherEmail, dto.teacherName);
    const roomName = `webinairev2-moodle-${randomUUID()}`;

    await this.livekitClients.roomService.createRoom({ name: roomName, emptyTimeout: 300 });

    const room = await this.prisma.room.create({
      data: {
        roomName,
        title: dto.title,
        creatorId: teacher.id,
        moodleCourseId: dto.courseId,
        moodleMeetingId: dto.meetingId,
        moodleReturnUrl: sanitizeReturnUrl(dto.returnUrl),
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

  async listRecordings(roomId: string, page = 1, perPage = RECORDINGS_DEFAULT_PER_PAGE): Promise<MoodleRecordingPageDto> {
    const room = await this.prisma.room.findUnique({ where: { id: roomId } });
    if (!room) throw new NotFoundException("Salle introuvable");

    const safePerPage = Math.min(Math.max(Math.trunc(perPage) || RECORDINGS_DEFAULT_PER_PAGE, 1), RECORDINGS_MAX_PER_PAGE);
    const safePage = Math.max(Math.trunc(page) || 1, 1);
    const where = { roomId, status: RecordingStatus.READY };

    const [total, recordings] = await this.prisma.$transaction([
      this.prisma.recording.count({ where }),
      this.prisma.recording.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (safePage - 1) * safePerPage,
        take: safePerPage,
      }),
    ]);

    const secret = this.config.get<string>("secrets.downloadLink")!;
    const frontendUrl = this.config.get<string>("frontendUrl")!;

    return {
      total,
      page: safePage,
      perPage: safePerPage,
      recordings: recordings.map((r): MoodleRecordingDto => {
        const exp = Math.floor(Date.now() / 1000) + MOODLE_PLAY_LINK_TTL_SECONDS;
        const token = signDownloadToken({ resourceId: r.id, exp }, secret);
        return {
          id: r.id,
          name: r.filename,
          date: r.createdAt.toISOString(),
          duration: r.duration,
          playUrl: `${frontendUrl}/api/recordings/download?token=${encodeURIComponent(token)}&inline=1`,
        };
      }),
    };
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
      if (room) {
        await this.enrollments.ensureEnrolled(room.id, user.id, "moodle-sync");

        // Rafraîchit l'URL de retour à chaque affichage de l'activité. C'est ce
        // qui rattrape les salles créées avant l'existence du champ, et ce qui
        // suit un déplacement de l'activité (le cmid change, l'URL aussi) sans
        // appel supplémentaire : le plugin passe déjà par ici à chaque vue.
        const returnUrl = sanitizeReturnUrl(dto.returnUrl);
        if (returnUrl && returnUrl !== room.moodleReturnUrl) {
          await this.prisma.room.update({
            where: { id: room.id },
            data: { moodleReturnUrl: returnUrl },
          });
        }
      }
    }

    return { userId: user.id, role: user.role };
  }
}
