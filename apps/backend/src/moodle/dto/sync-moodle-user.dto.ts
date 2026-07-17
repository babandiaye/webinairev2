import { IsBoolean, IsEmail, IsString, MinLength } from "class-validator";

export class SyncMoodleUserDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(1)
  name!: string;

  // Décidé côté plugin Moodle d'après le rôle d'inscription au cours : tout rôle
  // différent d'étudiant (Enseignant, Enseignant non éditeur, Gestionnaire...) => true.
  @IsBoolean()
  isTeacher!: boolean;
}
