import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma, Role, Room, RoomType } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { SessionUser } from "../auth/session.types";
import { EnrollmentDto, EnrollmentCsvSummaryDto } from "@webinairev2/shared-types";
import { CSV_IMPORT_BATCH_SIZE, parseCsvRows } from "../common/csv-rows.util";
import { randomUUID } from "crypto";

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

  // Les inscriptions n'existent QUE sur la salle principale : un sous-groupe
  // hérite des droits de sa salle mère. Sans cette résolution, un co-modérateur
  // (inscrit, mais pas créateur) voyait les contrôles de modération dans un
  // sous-groupe — BreakoutRoomsService.join() calcule bien ses droits sur la
  // salle parente — mais chaque action tombait en 403 côté RoomAccessGuard, qui
  // vérifiait le sous-groupe lui-même (aucune inscription ne s'y rattache).
  private async resolveAccessRoom(room: Room): Promise<Room> {
    if (room.type !== RoomType.BREAKOUT || !room.parentRoomId) return room;
    const parent = await this.prisma.room.findUnique({ where: { id: room.parentRoomId } });
    return parent ?? room;
  }

  // Point de vérité unique pour "cet utilisateur peut-il gérer cette salle" —
  // réutilisé par RoomAccessGuard (donc par toutes les actions déjà gardées par
  // @RequireRoomAccess : mute/kick, enregistrement, présence, sondages, tableau
  // blanc, sous-groupes, suppression) ainsi que par RoomsService.join() et les
  // quelques checks équivalents qui ne passaient pas par le guard.
  async canManageRoom(room: Room, user: SessionUser): Promise<boolean> {
    if (user.role === Role.ADMIN) return true;
    const target = await this.resolveAccessRoom(room);
    if (target.creatorId === user.id) return true;
    return this.isCoModerator(target.id, user);
  }

  // Pendant de canManageRoom pour les LECTURES liées à une salle (tableau
  // blanc, sondages, présentations, enregistrements) : un simple inscrit
  // (VIEWER) y a droit, contrairement aux actions de gestion. Sans ce contrôle,
  // ces contenus restaient lisibles par n'importe quel utilisateur authentifié
  // connaissant l'id de la salle, en contradiction avec la restriction
  // d'inscription appliquée partout ailleurs (voir RoomsService.list/join).
  async canViewRoom(room: Room, user: SessionUser): Promise<boolean> {
    if (user.role === Role.ADMIN) return true;
    const target = await this.resolveAccessRoom(room);
    if (target.creatorId === user.id) return true;
    return this.isEnrolled(target.id, user.id);
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
    } catch (e) {
      // P2002 = contrainte unique [roomId, userId] violée. Tout catcher
      // masquerait d'autres erreurs sous un diagnostic faux : un userId
      // inexistant (compte supprimé entre-temps) viole la clé étrangère
      // (P2003) et serait rapporté à tort comme "déjà inscrit".
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        throw new ConflictException("Cet utilisateur est déjà inscrit à ce cours");
      }
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2003") {
        throw new NotFoundException("Utilisateur introuvable");
      }
      throw e;
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

  csvTemplate(): string {
    return [
      "email,prenom,nom",
      "etudiant1@unchk.edu.sn,Aminata,Diallo",
      "etudiant2@unchk.edu.sn,Moussa,Ndiaye",
    ].join("\n");
  }

  /**
   * Inscrit une promotion entière à partir d'un fichier CSV.
   *
   * Inscrire 300 étudiants un par un via la recherche n'est pas praticable —
   * c'était le vrai frein à l'usage de la fonctionnalité d'inscription.
   *
   * Les comptes inconnus sont CRÉÉS en "pending:" (même mécanisme que l'import
   * d'utilisateurs) plutôt qu'ignorés : sans ça, un enseignant ne pourrait pas
   * préparer son cours avant que ses étudiants se soient connectés au moins une
   * fois, ce qui vide la fonctionnalité de son intérêt. Cela n'ouvre aucun
   * accès en soi : la ligne créée ne devient un compte utilisable qu'à la
   * première authentification Keycloak réussie (UserSyncService réconcilie alors
   * par email).
   *
   * La colonne "role" du format partagé est délibérément IGNORÉE ici : cette
   * route est ouverte aux enseignants (RequireRoomAccess), et honorer un
   * "role=ADMIN" dans un fichier déposé leur permettrait de se fabriquer des
   * administrateurs. Tout le monde est créé VIEWER ; la promotion de rôle reste
   * une action d'administrateur.
   */
  async importFromCsv(
    roomId: string,
    text: string,
    requesterId: string
  ): Promise<EnrollmentCsvSummaryDto> {
    const rows = parseCsvRows(text);
    if (rows.length === 0) {
      throw new BadRequestException("Aucun email valide trouvé dans le fichier");
    }

    // Un même email répété dans le fichier ne doit compter qu'une fois, sans
    // quoi les totaux rapportés seraient faux.
    const rowsByEmail = new Map(rows.map((row) => [row.email, row]));
    const uniqueRows = [...rowsByEmail.values()];

    const emailToUserId = new Map<string, string>();
    for (let i = 0; i < uniqueRows.length; i += CSV_IMPORT_BATCH_SIZE) {
      const batch = uniqueRows.slice(i, i + CSV_IMPORT_BATCH_SIZE).map((r) => r.email);
      const found = await this.prisma.user.findMany({
        where: { email: { in: batch } },
        select: { id: true, email: true },
      });
      for (const user of found) emailToUserId.set(user.email, user.id);
    }

    const missing = uniqueRows.filter((row) => !emailToUserId.has(row.email));
    let createdUsers = 0;
    for (let i = 0; i < missing.length; i += CSV_IMPORT_BATCH_SIZE) {
      const batch = missing.slice(i, i + CSV_IMPORT_BATCH_SIZE);
      const result = await this.prisma.user.createMany({
        data: batch.map((row) => ({
          email: row.email,
          name: row.name,
          role: Role.VIEWER,
          keycloakId: `pending:${randomUUID()}`,
        })),
        skipDuplicates: true,
      });
      createdUsers += result.count;
    }

    // Relecture après création plutôt que réutilisation des identifiants
    // supposés : createMany ne les renvoie pas, et skipDuplicates peut avoir
    // écarté une ligne créée entre-temps par un import concurrent.
    if (missing.length > 0) {
      for (let i = 0; i < missing.length; i += CSV_IMPORT_BATCH_SIZE) {
        const batch = missing.slice(i, i + CSV_IMPORT_BATCH_SIZE).map((r) => r.email);
        const found = await this.prisma.user.findMany({
          where: { email: { in: batch } },
          select: { id: true, email: true },
        });
        for (const user of found) emailToUserId.set(user.email, user.id);
      }
    }

    const userIds = uniqueRows
      .map((row) => emailToUserId.get(row.email))
      .filter((id): id is string => Boolean(id));

    let enrolled = 0;
    for (let i = 0; i < userIds.length; i += CSV_IMPORT_BATCH_SIZE) {
      const batch = userIds.slice(i, i + CSV_IMPORT_BATCH_SIZE);
      // skipDuplicates plutôt qu'un upsert par ligne : redéposer le fichier
      // d'une promotion doit rester sans effet, et rester une seule requête.
      const result = await this.prisma.enrollment.createMany({
        data: batch.map((userId) => ({ roomId, userId, createdBy: requesterId })),
        skipDuplicates: true,
      });
      enrolled += result.count;
    }

    return {
      total: uniqueRows.length,
      enrolled,
      alreadyEnrolled: userIds.length - enrolled,
      createdUsers,
    };
  }
}
