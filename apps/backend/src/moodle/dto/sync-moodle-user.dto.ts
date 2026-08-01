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

  // Page d'activité Moodle où renvoyer l'utilisateur en fin de séance. Renvoyée
  // à chaque affichage de l'activité : rattrape les salles créées avant
  // l'existence du champ et suit un déplacement de l'activité.
  //
  // Validé par MoodleService.sanitizeReturnUrl et NON par @IsUrl ici. @IsUrl
  // exige un TLD : un Moodle sur un nom d'hôte interne (http://moodle-interne/)
  // ou en local partait en 400, ce qui faisait échouer TOUT l'appel — donc
  // aussi l'inscription au cours qu'il porte, qui conditionne l'accès à la
  // salle. Le plugin avale l'exception dans un debugging() invisible : les
  // étudiants se retrouvaient sans inscription et sans le moindre message, à
  // cause d'un champ facultatif et purement cosmétique.
  // sanitizeReturnUrl rejette les schémas dangereux en renvoyant null, ce qui
  // dégrade proprement en « pas de retour » au lieu de tout interrompre.
  @IsOptional()
  @IsString()
  returnUrl?: string;
}
