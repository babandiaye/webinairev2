import { IsEmail, IsIn, IsString, MinLength } from "class-validator";
import { Role } from "@prisma/client";

const ROLES: Role[] = ["ADMIN", "MODERATOR", "VIEWER"];

export class CreateUserDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(1)
  name!: string;

  @IsIn(ROLES)
  role!: Role;
}
