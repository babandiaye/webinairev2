import { Controller, Get, Req, Res } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Request, Response } from "express";
import { generators } from "openid-client";
import { OidcClientService } from "./oidc-client.service";
import { UserSyncService } from "./user-sync.service";

@Controller("auth")
export class AuthController {
  constructor(
    private readonly oidc: OidcClientService,
    private readonly userSync: UserSyncService,
    private readonly config: ConfigService
  ) {}

  @Get("login")
  login(@Req() req: Request, @Res() res: Response) {
    const state = generators.state();
    const nonce = generators.nonce();
    req.session.oauthState = { state, nonce };

    const url = this.oidc.getClient().authorizationUrl({
      scope: "openid profile email",
      state,
      nonce,
    });

    res.redirect(url);
  }

  @Get("callback")
  async callback(@Req() req: Request, @Res() res: Response) {
    const client = this.oidc.getClient();
    const params = client.callbackParams(req);
    const saved = req.session.oauthState;

    if (!saved) {
      res.status(400).send("État OAuth manquant ou expiré, réessayez de vous connecter.");
      return;
    }

    // client.callback() vérifie la signature du id_token (JWKS), l'issuer, l'audience,
    // le nonce et le state — jamais de claim exploité avant cette vérification
    // complète (même exigence que la leçon C1 de l'audit livestreamv3, ici portée
    // par une librairie éprouvée plutôt qu'une vérification manuelle).
    const tokenSet = await client.callback(
      this.config.get<string>("keycloak.redirectUri")!,
      params,
      { state: saved.state, nonce: saved.nonce }
    );

    const claims = tokenSet.claims();

    // "name" = nom complet affiché (topbar/admin), "given_name" = prénom(s) usuel(s)
    // affiché seul dans le message d'accueil ("Bienvenue, Papa Amadou Baba 👋").
    const fullName = (claims.name as string) || claims.email || claims.sub;
    const givenName = (claims.given_name as string) || fullName;

    // Keycloak n'intervient que pour l'authentification — le rôle applicatif
    // n'est jamais lu depuis ses claims (voir user-sync.service.ts).
    const user = await this.userSync.syncFromKeycloak({
      keycloakId: claims.sub,
      email: claims.email ?? "",
      name: fullName,
    });

    delete req.session.oauthState;
    req.session.idToken = tokenSet.id_token;
    req.session.user = {
      id: user.id,
      email: user.email,
      name: user.name,
      givenName,
      role: user.role,
    };

    res.redirect(this.config.get<string>("frontendUrl")!);
  }

  @Get("logout")
  async logout(@Req() req: Request, @Res() res: Response) {
    const idToken = req.session.idToken;
    const issuer = this.config.get<string>("keycloak.issuer")!;
    const frontendUrl = this.config.get<string>("frontendUrl")!;

    req.session.destroy(() => {
      res.clearCookie("webinairev2.sid");

      const logoutUrl = new URL(`${issuer}/protocol/openid-connect/logout`);
      if (idToken) logoutUrl.searchParams.set("id_token_hint", idToken);
      logoutUrl.searchParams.set("post_logout_redirect_uri", frontendUrl);

      res.redirect(logoutUrl.toString());
    });
  }

  @Get("me")
  me(@Req() req: Request) {
    return req.session.user ?? null;
  }
}
