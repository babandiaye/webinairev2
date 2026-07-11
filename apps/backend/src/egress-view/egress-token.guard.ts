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
    const token = request.query?.token;
    if (!token) throw new UnauthorizedException("Token d'enregistrement manquant");

    const payload = verifyDownloadToken(token, this.config.get<string>("secrets.downloadLink")!);
    if (!payload || payload.resourceId !== request.params.roomId) {
      throw new UnauthorizedException("Token d'enregistrement invalide ou expiré");
    }

    return true;
  }
}
