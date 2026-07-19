import { IsBoolean, IsEmail, IsOptional, IsString, MinLength } from "class-validator";

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

  // Room.id (mod_webinairev2.roomid côté plugin) — quand fourni, inscrit aussi
  // cet utilisateur au cours (voir MoodleService.syncUser / EnrollmentsService.
  // ensureEnrolled). Optionnel : un compte peut être synchronisé avant que
  // l'activité n'ait encore de salle associée.
  @IsOptional()
  @IsString()
  roomId?: string;
}
