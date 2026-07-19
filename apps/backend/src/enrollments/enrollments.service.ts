import { ConflictException, Injectable } from "@nestjs/common";
import { Role, Room } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { SessionUser } from "../auth/session.types";
import { EnrollmentDto } from "@webinairev2/shared-types";

@Injectable()
export class EnrollmentsService {
  constructor(private readonly prisma: PrismaService) {}

  async isEnrolled(roomId: string, userId: string): Promise<boolean> {
    const enrollment = await this.prisma.enrollment.findUnique({
      where: { roomId_userId: { roomId, userId } },
    });
    return enrollment !== null;
  }

  // Un MODERATOR inscrit sur le cours d'un autre modérateur devient
  // co-modérateur — un VIEWER inscrit reste un simple étudiant, jamais
  // gestionnaire même inscrit.
  async isCoModerator(roomId: string, user: SessionUser): Promise<boolean> {
    if (user.role !== Role.MODERATOR) return false;
    return this.isEnrolled(roomId, user.id);
  }

  // Point de vérité unique pour "cet utilisateur peut-il gérer cette salle" —
  // réutilisé par RoomAccessGuard (donc par toutes les actions déjà gardées par
  // @RequireRoomAccess : mute/kick, enregistrement, présence, sondages, tableau
  // blanc, sous-groupes, suppression) ainsi que par RoomsService.join() et les
  // quelques checks équivalents qui ne passaient pas par le guard.
  async canManageRoom(room: Room, user: SessionUser): Promise<boolean> {
    if (user.role === Role.ADMIN) return true;
    if (room.creatorId === user.id) return true;
    return this.isCoModerator(room.id, user);
  }

  async list(roomId: string): Promise<EnrollmentDto[]> {
    const enrollments = await this.prisma.enrollment.findMany({
      where: { roomId },
      include: { user: { select: { id: true, name: true, email: true, role: true } } },
      orderBy: { createdAt: "asc" },
    });
    return enrollments.map((e) => ({
      id: e.id,
      userId: e.user.id,
      name: e.user.name,
      email: e.user.email,
      role: e.user.role,
      createdAt: e.createdAt.toISOString(),
    }));
  }

  async enroll(roomId: string, userId: string, requesterId: string): Promise<EnrollmentDto> {
    try {
      const enrollment = await this.prisma.enrollment.create({
        data: { roomId, userId, createdBy: requesterId },
        include: { user: { select: { id: true, name: true, email: true, role: true } } },
      });
      return {
        id: enrollment.id,
        userId: enrollment.user.id,
        name: enrollment.user.name,
        email: enrollment.user.email,
        role: enrollment.user.role,
        createdAt: enrollment.createdAt.toISOString(),
      };
    } catch {
      // Contrainte unique [roomId, userId] déjà violée.
      throw new ConflictException("Cet utilisateur est déjà inscrit à ce cours");
    }
  }

  async unenroll(roomId: string, userId: string): Promise<void> {
    await this.prisma.enrollment.deleteMany({ where: { roomId, userId } });
  }

  // Variante idempotente d'enroll(), utilisée par la synchronisation Moodle
  // (MoodleService.syncUser) — appelée à chaque affichage de l'activité côté
  // plugin, ne doit jamais échouer si l'inscription existe déjà (contrairement
  // à enroll(), qui lève délibérément un 409 pour l'action interactive
  // "Inscrire" de la page Étudiants).
  async ensureEnrolled(roomId: string, userId: string, createdBy: string): Promise<void> {
    await this.prisma.enrollment.upsert({
      where: { roomId_userId: { roomId, userId } },
      update: {},
      create: { roomId, userId, createdBy },
    });
  }

  // Utilisé par RoomsService.list() pour calculer canManage/visibilité sans
  // N+1 — un seul findMany pour toutes les salles retournées.
  async enrolledRoomIds(userId: string): Promise<Set<string>> {
    const rows = await this.prisma.enrollment.findMany({
      where: { userId },
      select: { roomId: true },
    });
    return new Set(rows.map((r) => r.roomId));
  }
}
