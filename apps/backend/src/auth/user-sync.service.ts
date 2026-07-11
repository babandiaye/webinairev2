import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { Role } from "@prisma/client";

interface KeycloakProfile {
  keycloakId: string;
  email: string;
  name: string;
}

@Injectable()
export class UserSyncService {
  private readonly logger = new Logger(UserSyncService.name);

  constructor(private readonly prisma: PrismaService) {}

  // Keycloak ne gère que l'authentification (identité, email, nom) — le rôle
  // applicatif est entièrement géré en base via /admin/users et n'est jamais
  // synchronisé depuis Keycloak. Le resynchroniser à chaque login écraserait
  // silencieusement toute promotion/rétrogradation faite depuis l'admin dès la
  // reconnexion suivante de l'utilisateur concerné.
  async syncFromKeycloak(profile: KeycloakProfile) {
    const existing = await this.prisma.user.findUnique({
      where: { keycloakId: profile.keycloakId },
    });

    if (existing) {
      return this.prisma.user.update({
        where: { id: existing.id },
        data: { email: profile.email, name: profile.name },
      });
    }

    // Un utilisateur peut avoir été référencé par email avant sa toute première
    // connexion Keycloak (ex. enseignant Moodle désigné créateur d'une Room via
    // POST /moodle/rooms, appelé serveur-à-serveur sans identité Keycloak connue —
    // voir MoodleService.upsertTeacherByEmail). On adopte cette ligne existante
    // (même id, donc creatorId reste valide) plutôt que d'en créer une seconde qui
    // entrerait en conflit sur la contrainte unique email. Le préfixe "pending:"
    // garantit qu'on n'adopte jamais un compte réel par coïncidence d'email.
    const placeholder = await this.prisma.user.findUnique({ where: { email: profile.email } });
    if (placeholder && placeholder.keycloakId.startsWith("pending:")) {
      return this.prisma.user.update({
        where: { id: placeholder.id },
        data: { keycloakId: profile.keycloakId, name: profile.name },
      });
    }

    return this.prisma.user.create({
      data: {
        keycloakId: profile.keycloakId,
        email: profile.email,
        name: profile.name,
        role: Role.VIEWER,
      },
    });
  }
}
