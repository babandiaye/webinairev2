import { IsDefined } from "class-validator";

export class SaveWhiteboardDto {
  @IsDefined()
  sceneData!: unknown;
}
