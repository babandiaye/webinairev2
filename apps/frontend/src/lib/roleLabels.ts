import { Role } from "@webinairev2/shared-types";

export const ROLE_LABELS: Record<Role, string> = {
  ADMIN: "Administrateur",
  MODERATOR: "Modérateur",
  VIEWER: "Participant",
};

export const ROLES: Role[] = ["ADMIN", "MODERATOR", "VIEWER"];
