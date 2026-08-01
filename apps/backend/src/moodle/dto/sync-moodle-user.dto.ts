import { IsBoolean, IsEmail, IsOptional, IsString, IsUrl, MinLength } from "class-validator";

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

  // Page d'activité Moodle où renvoyer l'utilisateur en fin de séance. Renvoyée
  // à chaque affichage de l'activité : rattrape les salles créées avant
  // l'existence du champ et suit un déplacement de l'activité.
  @IsOptional()
  @IsUrl({ require_protocol: true })
  returnUrl?: string;
}
