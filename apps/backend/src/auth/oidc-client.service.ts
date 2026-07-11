import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Issuer, Client } from "openid-client";

// Le client "unchk-monitor" est un client Keycloak CONFIDENTIEL (avec secret),
// partagé avec le projet unchk-monitor. Un client confidentiel ne doit jamais
// exposer son secret à un navigateur : l'échange code→tokens se fait donc
// intégralement côté serveur (ce service), jamais côté SPA.
@Injectable()
export class OidcClientService implements OnModuleInit {
  private readonly logger = new Logger(OidcClientService.name);
  private client!: Client;

  constructor(private readonly config: ConfigService) {}

  async onModuleInit() {
    const issuerUrl = this.config.get<string>("keycloak.issuer")!;
    const issuer = await Issuer.discover(issuerUrl);

    this.client = new issuer.Client({
      client_id: this.config.get<string>("keycloak.clientId")!,
      client_secret: this.config.get<string>("keycloak.clientSecret")!,
      redirect_uris: [this.config.get<string>("keycloak.redirectUri")!],
      response_types: ["code"],
    });

    this.logger.log(`OIDC issuer découvert : ${issuer.issuer}`);
  }

  getClient(): Client {
    if (!this.client) {
      throw new Error("Client OIDC pas encore initialisé (discovery en cours ou échouée)");
    }
    return this.client;
  }
}
