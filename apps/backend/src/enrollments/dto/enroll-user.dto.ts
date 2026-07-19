import { IsString, MinLength } from "class-validator";

export class EnrollUserDto {
  @IsString()
  @MinLength(1)
  userId!: string;
}
