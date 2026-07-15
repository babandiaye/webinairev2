import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { timingSafeEqual } from "crypto";

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
    const expected = this.config.get<string>("moodle.apiKey")!;

    // timingSafeEqual (même pattern que download-token.util.ts) plutôt que
    // !== : une comparaison de chaîne classique s'arrête au premier octet
    // différent, ce qui fuit la longueur du préfixe correct via le temps de
    // réponse — négligeable en pratique ici, mais le coût de le faire
    // correctement est nul.
    const keyBuf = Buffer.from(typeof key === "string" ? key : "");
    const expectedBuf = Buffer.from(expected);
    const valid = keyBuf.length === expectedBuf.length && timingSafeEqual(keyBuf, expectedBuf);

    if (!valid) {
      throw new UnauthorizedException("Clé API Moodle invalide");
    }
    return true;
  }
}
