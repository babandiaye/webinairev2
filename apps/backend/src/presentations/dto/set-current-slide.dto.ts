import { IsInt, Min } from "class-validator";

export class SetCurrentSlideDto {
  @IsInt()
  @Min(0)
  slideIndex!: number;
}
