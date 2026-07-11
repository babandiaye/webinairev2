import { IsString, MinLength } from "class-validator";

export class CreateRoomDto {
  @IsString()
  @MinLength(3)
  title!: string;
}
