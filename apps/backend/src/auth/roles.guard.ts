import { CanActivate, ExecutionContext, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { Role } from "@prisma/client";
import { ROLES_KEY } from "./roles.decorator";

// Contrôle de rôle applicatif global (ex. ADMIN pour la gestion des utilisateurs).
// Pour les actions liées à une salle précise (kick, recording, breakout...), voir
// room-access.guard.ts qui vérifie en plus la propriété de la Room, pas seulement le rôle.
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const { user } = context.switchToHttp().getRequest();
    return !!user && required.includes(user.role);
  }
}
