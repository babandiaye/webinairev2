import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { verifyDownloadToken } from "../common/download-token.util";

// Authentifie le navigateur headless de LiveKit Web Egress — celui-ci n'a pas de
// cookie de session (pas de login Keycloak interactif possible dans un Chrome
// headless), donc un token HMAC signé et expirant (même mécanisme que les liens
// de téléchargement d'enregistrement) tient lieu d'autorisation, scopé à une
// seule salle et à la durée de l'enregistrement.
@Injectable()
export class EgressTokenGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    // En-tête plutôt que query string : ces routes sont interrogées par polling
    // (whiteboard/présentation, toutes les 4s pendant toute la session — voir
    // egressApi.ts) ; un token en query apparaîtrait dans les logs d'accès nginx
    // à chaque requête, potentiellement des centaines de fois par enregistrement.
    const token = request.headers["x-egress-token"];
    if (!token) throw new UnauthorizedException("Token d'enregistrement manquant");

    const payload = verifyDownloadToken(token, this.config.get<string>("secrets.downloadLink")!);
    if (!payload || payload.resourceId !== request.params.roomId) {
      throw new UnauthorizedException("Token d'enregistrement invalide ou expiré");
    }

    return true;
  }
}
