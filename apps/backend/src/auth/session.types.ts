import "express-session";
import { Role } from "@prisma/client";

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  givenName: string;
  role: Role;
}

declare module "express-session" {
  interface SessionData {
    user?: SessionUser;
    idToken?: string;
    oauthState?: { state: string; nonce: string };
    // Chemin interne où revenir après le retour de Keycloak — toujours relatif,
    // jamais une URL absolue (voir AuthController.sanitizeInternalPath).
    postLoginRedirect?: string;
  }
}
