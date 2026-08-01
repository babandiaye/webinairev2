import { IsBoolean, IsOptional } from "class-validator";

export class UpdateRoomSettingsDto {
  @IsOptional()
  @IsBoolean()
  micLocked?: boolean;

  @IsOptional()
  @IsBoolean()
  cameraLocked?: boolean;

  @IsOptional()
  @IsBoolean()
  chatLocked?: boolean;

  @IsOptional()
  @IsBoolean()
  reactionsLocked?: boolean;

  @IsOptional()
  @IsBoolean()
  participantListLocked?: boolean;
}
