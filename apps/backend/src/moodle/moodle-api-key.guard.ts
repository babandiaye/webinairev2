import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

// Auth serveur-à-serveur pour le plugin Moodle (mod_webinairev2) : une clé statique
// partagée, jamais une session Keycloak (Moodle appelle ces routes en PHP, sans
// navigateur ni cookie). Volontairement distinct de SessionAuthGuard/RoomAccessGuard —
// ces routes ne représentent aucun utilisateur webinairev2 précis, seulement Moodle
// lui-même, qui a déjà vérifié ses propres capacités (mod/webinairev2:moderate, etc.)
// avant d'appeler l'API.
@Injectable()
export class MoodleApiKeyGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const key = request.headers["x-api-key"];
    const expected = this.config.get<string>("moodle.apiKey");

    if (!key || key !== expected) {
      throw new UnauthorizedException("Clé API Moodle invalide");
    }
    return true;
  }
}
