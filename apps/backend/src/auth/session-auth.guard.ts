import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";
import { Request } from "express";

@Injectable()
export class SessionAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req: Request = context.switchToHttp().getRequest();

    if (!req.session?.user) {
      throw new UnauthorizedException("Non authentifié");
    }

    // request.user est lu par CurrentUser()/RolesGuard/RoomAccessGuard — même
    // contrat qu'avant, seule la source (session plutôt que Bearer JWT) change.
    (req as any).user = req.session.user;
    return true;
  }
}
