import { IsBoolean, IsOptional } from "class-validator";

export class UpdateRoomSettingsDto {
  @IsOptional()
  @IsBoolean()
  micLocked?: boolean;

  @IsOptional()
  @IsBoolean()
  cameraLocked?: boolean;
}
