import { BadRequestException, Injectable } from "@nestjs/common";
import { Role } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { UserDto } from "@webinairev2/shared-types";

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async list(): Promise<UserDto[]> {
    const users = await this.prisma.user.findMany({ orderBy: { createdAt: "asc" } });
    return users.map(this.toDto);
  }

  async updateRole(targetId: string, role: Role, requesterId: string): Promise<UserDto> {
    if (targetId === requesterId) {
      // Un admin qui se retire ADMIN pourrait se verrouiller hors de la gestion des
      // rôles sans qu'aucun autre compte ne puisse l'y remettre depuis l'UI.
      throw new BadRequestException("Vous ne pouvez pas modifier votre propre rôle");
    }

    const user = await this.prisma.user.update({ where: { id: targetId }, data: { role } });
    return this.toDto(user);
  }

  private toDto(user: { id: string; email: string; name: string; role: Role }): UserDto {
    // givenName précis (claim Keycloak) uniquement disponible pour l'utilisateur de la
    // session en cours (auth.controller.ts) ; ici, simple dérivation pour la liste admin.
    return { id: user.id, email: user.email, name: user.name, givenName: user.name.split(" ")[0], role: user.role };
  }
}
