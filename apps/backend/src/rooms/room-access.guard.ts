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

// Toute action sensible sur une Room (kick, start/stop recording, breakout,
// modération de sondage, changement de slide...) doit porter ce décorateur dès son
// premier commit — c'est l'application directe de la leçon C2 de l'audit
// livestreamv3 (absence de contrôle "créateur de salle" corrigée après coup).
export const RequireRoomAccess = () => SetMetadata(ROOM_ACCESS_KEY, true);

@Injectable()
export class RoomAccessGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
    private readonly enrollments: EnrollmentsService
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<boolean>(ROOM_ACCESS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required) return true;

    const request = context.switchToHttp().getRequest();
    const roomId = request.params.roomId ?? request.params.id;
    const user = request.user;

    const room = await this.prisma.room.findUnique({ where: { id: roomId } });
    if (!room) throw new NotFoundException("Salle introuvable");

    if (!(await this.enrollments.canManageRoom(room, user))) {
      throw new ForbiddenException(
        "Seul le créateur de la salle, un co-modérateur inscrit, ou un administrateur peut effectuer cette action"
      );
    }

    request.room = room;
    return true;
  }
}
