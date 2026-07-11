import { Type } from "class-transformer";
import { ArrayMaxSize, IsArray, IsOptional, IsString, ValidateNested } from "class-validator";

class BreakoutAssignmentEntry {
  @IsString()
  userId!: string;

  @IsOptional()
  @IsString()
  breakoutRoomId!: string | null;
}

export class AssignBreakoutDto {
  @IsArray()
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => BreakoutAssignmentEntry)
  assignments!: BreakoutAssignmentEntry[];
}
