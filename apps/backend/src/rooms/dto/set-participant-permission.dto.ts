import { IsBoolean } from "class-validator";

export class SetParticipantPermissionDto {
  @IsBoolean()
  grant!: boolean;
}
