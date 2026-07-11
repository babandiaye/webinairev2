import { IsBoolean } from "class-validator";

export class SetWhiteboardStateDto {
  @IsBoolean()
  open!: boolean;
}
