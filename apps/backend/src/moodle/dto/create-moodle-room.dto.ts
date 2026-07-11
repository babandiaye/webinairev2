import { IsEmail, IsOptional, IsString, MinLength } from "class-validator";

export class CreateMoodleRoomDto {
  @IsString()
  @MinLength(1)
  courseId!: string;

  // Identifiant unique de l'instance d'activité côté Moodle (course_module id) —
  // clé d'idempotence : un rappel de add_instance ne doit jamais créer deux Room.
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
}
