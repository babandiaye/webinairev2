import { IsIn } from "class-validator";
import { Role } from "@prisma/client";

const ROLES: Role[] = ["ADMIN", "MODERATOR", "VIEWER"];

export class UpdateRoleDto {
  @IsIn(ROLES)
  role!: Role;
}
