import { BadRequestException, ConflictException, Injectable } from "@nestjs/common";
import { randomUUID } from "crypto";
import { Role } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { SessionStoreService } from "../auth/session-store.service";
import { AdminUserDto, CreateUserDto, CsvImportSummaryDto, EnrollableUserDto } from "@webinairev2/shared-types";

type UserRow = {
  id: string;
  email: string;
  name: string;
  role: Role;
  active: boolean;
  keycloakId: string;
  _count?: { createdRooms: number };
};

const CSV_EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CSV_IMPORT_BATCH_SIZE = 500;
const CSV_VALID_ROLES: Role[] = ["ADMIN", "MODERATOR", "VIEWER"];
const ENROLLABLE_SEARCH_LIMIT = 20;

interface CsvRow {
  email: string;
  name: string;
  role: Role;
}

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sessionStore: SessionStoreService
  ) {}

  async list(): Promise<AdminUserDto[]> {
    const users = await this.prisma.user.findMany({
      orderBy: { createdAt: "asc" },
      include: { _count: { select: { createdRooms: true } } },
    });
    return users.map((u) => this.toDto(u));
  }

  // Utilisé par la page d'inscription d'un cours (accessible aux modérateurs,
  // pas seulement aux admins, contrairement à list()) — jamais la liste
  // complète des comptes, seulement une recherche bornée par nom/email.
  async searchEnrollable(query: string): Promise<EnrollableUserDto[]> {
    const q = query.trim();
    if (q.length === 0) return [];

    const users = await this.prisma.user.findMany({
      where: {
        active: true,
        OR: [{ name: { contains: q, mode: "insensitive" } }, { email: { contains: q, mode: "insensitive" } }],
      },
      orderBy: { name: "asc" },
      take: ENROLLABLE_SEARCH_LIMIT,
      select: { id: true, name: true, email: true, role: true },
    });
    return users;
  }

  async updateRole(targetId: string, role: Role, requesterId: string): Promise<AdminUserDto> {
    if (targetId === requesterId) {
      // Un admin qui se retire ADMIN pourrait se verrouiller hors de la gestion des
      // rôles sans qu'aucun autre compte ne puisse l'y remettre depuis l'UI.
      throw new BadRequestException("Vous ne pouvez pas modifier votre propre rôle");
    }

    const user = await this.prisma.user.update({
      where: { id: targetId },
      data: { role },
      include: { _count: { select: { createdRooms: true } } },
    });

    // req.session.user (lu par SessionAuthGuard à chaque requête) est une copie
    // figée à la connexion, jamais rafraîchie — sans cette révocation, une
    // session déjà ouverte garderait l'ancien rôle (donc ses anciens
    // privilèges, ex. MODERATOR rétrogradé en VIEWER) jusqu'à ce que
    // l'utilisateur se déconnecte lui-même. Même logique que setActive()
    // ci-dessous, appliquée ici à TOUT changement de rôle, pas seulement une
    // désactivation.
    await this.sessionStore.revokeUserSessions(targetId);

    return this.toDto(user);
  }

  // Désactiver plutôt que supprimer par défaut : réversible, ne touche pas aux
  // salles déjà créées par cet utilisateur (contrainte FK Room.creatorId), et
  // révoque immédiatement toute session déjà ouverte (voir SessionStoreService —
  // sans ça, un compte "désactivé" resterait pleinement fonctionnel pour
  // quelqu'un déjà connecté).
  async setActive(targetId: string, active: boolean, requesterId: string): Promise<AdminUserDto> {
    if (targetId === requesterId) {
      throw new BadRequestException("Vous ne pouvez pas désactiver votre propre compte");
    }

    const user = await this.prisma.user.update({
      where: { id: targetId },
      data: { active },
      include: { _count: { select: { createdRooms: true } } },
    });

    if (!active) await this.sessionStore.revokeUserSessions(targetId);

    return this.toDto(user);
  }

  // Hard delete volontairement refusé tant que l'utilisateur a créé des salles :
  // Room.creatorId n'a pas d'onDelete cascade (choix délibéré, une salle ne doit
  // jamais perdre son créateur silencieusement) — la contrainte FK ferait de
  // toute façon échouer la suppression, mais avec une erreur Postgres brute
  // plutôt qu'un message actionnable pour l'admin.
  async remove(targetId: string, requesterId: string): Promise<void> {
    if (targetId === requesterId) {
      throw new BadRequestException("Vous ne pouvez pas supprimer votre propre compte");
    }

    const roomCount = await this.prisma.room.count({ where: { creatorId: targetId } });
    if (roomCount > 0) {
      throw new BadRequestException(
        `Ce compte a créé ${roomCount} salle(s) : supprimez-les ou changez-en le créateur avant de supprimer ce compte.`
      );
    }

    await this.sessionStore.revokeUserSessions(targetId);
    await this.prisma.user.delete({ where: { id: targetId } });
  }

  // Utilisé aussi par MoodleService — un enseignant/utilisateur peut être référencé
  // avant sa toute première connexion Keycloak. keycloakId "pending:<uuid>" garantit
  // l'unicité tout en étant reconnaissable ; la vraie connexion Keycloak adoptera
  // cette ligne (voir UserSyncService.syncFromKeycloak) plutôt que d'en créer une
  // seconde en conflit sur la contrainte unique email.
  // Ne met jamais à jour un compte déjà existant (pending ou réel) — idempotent
  // au sens strict, appelant responsable de gérer les mises à jour explicites.
  async createOrGetPendingByEmail(email: string, name: string, role: Role): Promise<AdminUserDto> {
    const existing = await this.prisma.user.findUnique({
      where: { email },
      include: { _count: { select: { createdRooms: true } } },
    });
    if (existing) return this.toDto(existing);

    const created = await this.prisma.user.create({
      data: { email, name, role, keycloakId: `pending:${randomUUID()}` },
      include: { _count: { select: { createdRooms: true } } },
    });
    return this.toDto(created);
  }

  // Règle "promotion, jamais rétrogradation" : Moodle nous dit seulement "cette
  // personne a un rôle non-étudiant sur ce cours", jamais "retire ses droits" — un
  // modérateur (ou admin) qui serait par ailleurs inscrit comme étudiant sur un
  // autre cours ne doit jamais perdre son rôle applicatif via ce chemin. Crée le
  // compte en MODERATOR s'il n'existe pas, promeut un VIEWER existant, ne touche
  // jamais un MODERATOR/ADMIN déjà en place.
  async ensureAtLeastModerator(email: string, name: string): Promise<AdminUserDto> {
    const existing = await this.prisma.user.findUnique({
      where: { email },
      include: { _count: { select: { createdRooms: true } } },
    });

    if (!existing) {
      const created = await this.prisma.user.create({
        data: { email, name, role: Role.MODERATOR, keycloakId: `pending:${randomUUID()}` },
        include: { _count: { select: { createdRooms: true } } },
      });
      return this.toDto(created);
    }

    if (existing.role !== Role.VIEWER) return this.toDto(existing);

    const updated = await this.prisma.user.update({
      where: { id: existing.id },
      data: { role: Role.MODERATOR },
      include: { _count: { select: { createdRooms: true } } },
    });
    return this.toDto(updated);
  }

  // Contrairement à createOrGetPendingByEmail (silencieux, pensé pour un appel
  // serveur-à-serveur répété comme Moodle), une création explicite depuis l'UI
  // admin doit prévenir si l'email appartient déjà à un compte réel, et mettre à
  // jour nom/rôle si un placeholder "pending:" existait déjà (ex. déjà créé via
  // Moodle) plutôt que de le laisser tel quel.
  async createManual(dto: CreateUserDto): Promise<AdminUserDto> {
    const existing = await this.prisma.user.findUnique({
      where: { email: dto.email },
      include: { _count: { select: { createdRooms: true } } },
    });

    if (existing) {
      if (!existing.keycloakId.startsWith("pending:")) {
        throw new ConflictException("Un compte existe déjà avec cet email");
      }
      const updated = await this.prisma.user.update({
        where: { id: existing.id },
        data: { name: dto.name, role: dto.role },
        include: { _count: { select: { createdRooms: true } } },
      });
      return this.toDto(updated);
    }

    const created = await this.prisma.user.create({
      data: {
        email: dto.email,
        name: dto.name,
        role: dto.role,
        keycloakId: `pending:${randomUUID()}`,
      },
      include: { _count: { select: { createdRooms: true } } },
    });
    return this.toDto(created);
  }

  private toDto(user: UserRow): AdminUserDto {
    // givenName précis (claim Keycloak) uniquement disponible pour l'utilisateur de la
    // session en cours (auth.controller.ts) ; ici, simple dérivation pour la liste admin.
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      givenName: user.name.split(" ")[0],
      role: user.role,
      active: user.active,
      roomCount: user._count?.createdRooms ?? 0,
    };
  }

  csvTemplate(): string {
    return [
      "email,prenom,nom,role",
      "etudiant1@unchk.edu.sn,Aminata,Diallo,VIEWER",
      "etudiant2@unchk.edu.sn,Moussa,Ndiaye,VIEWER",
      "enseignant1@unchk.edu.sn,Fatou,Sow,MODERATOR",
    ].join("\n");
  }

  // Format toléré : virgule ou point-virgule, en-tête optionnel (détecté via
  // "email"/"mail" sur la 1ère ligne), colonnes prenom/nom/role optionnelles et
  // repérées par leur nom plutôt que leur position — reprend le format déjà en
  // usage sur livestreamv3 (import-csv), avec une colonne "role" en plus.
  private parseCsv(text: string): CsvRow[] {
    const lines = text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    if (lines.length === 0) return [];

    const sep = lines[0].includes(";") ? ";" : ",";
    const firstLower = lines[0].toLowerCase();
    const hasHeader = firstLower.includes("email") || firstLower.includes("mail");
    const dataLines = hasHeader ? lines.slice(1) : lines;

    let emailCol = 0;
    let prenomCol = -1;
    let nomCol = -1;
    let roleCol = -1;
    if (hasHeader) {
      const headers = lines[0].toLowerCase().split(sep).map((h) => h.trim());
      emailCol = headers.findIndex((h) => h.includes("email") || h.includes("mail"));
      prenomCol = headers.findIndex(
        (h) => h.includes("prenom") || h.includes("prénom") || h.includes("firstname") || h.includes("first")
      );
      nomCol = headers.findIndex(
        (h) =>
          (h.includes("nom") && !h.includes("prenom") && !h.includes("prénom")) ||
          h.includes("lastname") ||
          h.includes("last")
      );
      roleCol = headers.findIndex((h) => h.includes("role") || h.includes("rôle"));
      if (emailCol === -1) emailCol = 0;
    }

    const rows: CsvRow[] = [];
    for (const line of dataLines) {
      const cols = line.split(sep).map((c) => c.trim().replace(/^["']|["']$/g, ""));
      const email = cols[emailCol] ?? cols.find((c) => CSV_EMAIL_RE.test(c)) ?? "";
      if (!CSV_EMAIL_RE.test(email)) continue;

      const prenom = prenomCol >= 0 ? (cols[prenomCol] ?? "") : "";
      const nom =
        nomCol >= 0
          ? (cols[nomCol] ?? "")
          : prenomCol >= 0 && cols.length > prenomCol + 1
            ? (cols[prenomCol + 1] ?? "")
            : "";
      const name = [prenom, nom].filter(Boolean).join(" ") || email.split("@")[0];

      const roleRaw = roleCol >= 0 ? (cols[roleCol] ?? "").toUpperCase() : "";
      const role = (CSV_VALID_ROLES as string[]).includes(roleRaw) ? (roleRaw as Role) : Role.VIEWER;

      rows.push({ email: email.toLowerCase(), name, role });
    }
    return rows;
  }

  // Comptes manquants créés en "pending:" (même mécanisme que createOrGetPendingByEmail,
  // en createMany par lots pour rester correct sur un import de plusieurs centaines de
  // lignes — une salle créée n'a jamais de rapport avec un import CSV, donc jamais
  // besoin de vérifier de compteur de salles ici, contrairement à remove()).
  async importFromCsv(text: string): Promise<CsvImportSummaryDto> {
    const rows = this.parseCsv(text);
    if (rows.length === 0) {
      throw new BadRequestException("Aucun email valide trouvé dans le fichier");
    }

    const rowsByEmail = new Map<string, CsvRow>();
    for (const row of rows) rowsByEmail.set(row.email, row);
    const uniqueRows = [...rowsByEmail.values()];

    const existingEmails = new Set<string>();
    for (let i = 0; i < uniqueRows.length; i += CSV_IMPORT_BATCH_SIZE) {
      const batch = uniqueRows.slice(i, i + CSV_IMPORT_BATCH_SIZE).map((r) => r.email);
      const found = await this.prisma.user.findMany({
        where: { email: { in: batch } },
        select: { email: true },
      });
      for (const u of found) existingEmails.add(u.email);
    }

    const missingRows = uniqueRows.filter((r) => !existingEmails.has(r.email));
    let created = 0;
    for (let i = 0; i < missingRows.length; i += CSV_IMPORT_BATCH_SIZE) {
      const batch = missingRows.slice(i, i + CSV_IMPORT_BATCH_SIZE);
      const res = await this.prisma.user.createMany({
        data: batch.map((r) => ({
          email: r.email,
          name: r.name,
          role: r.role,
          keycloakId: `pending:${randomUUID()}`,
        })),
        skipDuplicates: true,
      });
      created += res.count;
    }

    return { total: uniqueRows.length, created, skipped: uniqueRows.length - created };
  }
}
