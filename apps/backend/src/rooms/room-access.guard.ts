import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  NotFoundException,
  SetMetadata,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { PrismaService } from "../prisma/prisma.service";
import { EnrollmentsService } from "../enrollments/enrollments.service";

export const ROOM_ACCESS_KEY = "requireRoomAccess";
export const ROOM_VIEW_KEY = "requireRoomView";

// Toute action sensible sur une Room (kick, start/stop recording, breakout,
// modération de sondage, changement de slide...) doit porter ce décorateur dès son
// premier commit — c'est l'application directe de la leçon C2 de l'audit
// livestreamv3 (absence de contrôle "créateur de salle" corrigée après coup).
export const RequireRoomAccess = () => SetMetadata(ROOM_ACCESS_KEY, true);

// Pendant du précédent pour les LECTURES et les actions ouvertes aux simples
// participants (consulter le tableau blanc, voter à un sondage, lister les
// diapositives/enregistrements) : exige d'être inscrit au cours, pas d'en être
// gestionnaire. Sans lui, ces routes n'étaient gardées que par
// SessionAuthGuard, donc accessibles à tout utilisateur authentifié de la
// plateforme connaissant l'id de la salle.
export const RequireRoomView = () => SetMetadata(ROOM_VIEW_KEY, true);

@Injectable()
export class RoomAccessGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
    private readonly enrollments: EnrollmentsService
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const handlerAndClass = [context.getHandler(), context.getClass()];
    const requiresManage = this.reflector.getAllAndOverride<boolean>(ROOM_ACCESS_KEY, handlerAndClass);
    const requiresView = this.reflector.getAllAndOverride<boolean>(ROOM_VIEW_KEY, handlerAndClass);
    if (!requiresManage && !requiresView) return true;

    const request = context.switchToHttp().getRequest();
    const roomId = request.params.roomId ?? request.params.id;
    const user = request.user;

    const room = await this.prisma.room.findUnique({ where: { id: roomId } });
    if (!room) throw new NotFoundException("Salle introuvable");

    if (requiresManage) {
      if (!(await this.enrollments.canManageRoom(room, user))) {
        throw new ForbiddenException(
          "Seul le créateur de la salle, un co-modérateur inscrit, ou un administrateur peut effectuer cette action"
        );
      }
    } else if (!(await this.enrollments.canViewRoom(room, user))) {
      throw new ForbiddenException("Vous n'êtes pas inscrit à ce cours");
    }

    request.room = room;
    return true;
  }
}
