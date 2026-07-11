import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsOptional, IsString, MinLength } from "class-validator";

export class CreatePollDto {
  @IsString()
  @MinLength(3)
  question!: string;

  @IsArray()
  @ArrayMinSize(2)
  @ArrayMaxSize(10)
  @IsString({ each: true })
  options!: string[];

  @IsOptional()
  @IsBoolean()
  multiple?: boolean;
}
