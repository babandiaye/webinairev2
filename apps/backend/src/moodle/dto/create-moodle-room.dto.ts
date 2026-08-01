import { IsEmail, IsOptional, IsString, IsUrl, MinLength } from "class-validator";

export class CreateMoodleRoomDto {
  @IsString()
  @MinLength(1)
  courseId!: string;

  // Id de l'instance d'activité côté Moodle. MÉTADONNÉE DE PROVENANCE seulement :
  // il n'est unique qu'au sein d'une plateforme, ce backend en sert plusieurs.
  // Voir MoodleService.createRoom pour l'incident que sa réutilisation a causé.
  @IsString()
  @MinLength(1)
  meetingId!: string;

  @IsString()
  @MinLength(3)
  title!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsEmail()
  teacherEmail!: string;

  @IsString()
  @MinLength(1)
  teacherName!: string;

  // Page d'activité Moodle où renvoyer l'utilisateur en fin de séance. Transmise
  // ici, serveur-à-serveur, et jamais par la barre d'adresse : chaque salle porte
  // celle de SA plateforme, sans liste blanche à configurer côté frontend.
  @IsOptional()
  @IsUrl({ require_protocol: true })
  returnUrl?: string;
}
