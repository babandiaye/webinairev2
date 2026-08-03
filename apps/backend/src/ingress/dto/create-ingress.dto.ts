import { IsIn } from "class-validator";
import { CreateIngressDto as CreateIngressDtoShape, IngressProtocol } from "@webinairev2/shared-types";

const PROTOCOLS: IngressProtocol[] = ["rtmp", "whip"];

export class CreateIngressDto implements CreateIngressDtoShape {
  @IsIn(PROTOCOLS, { message: `protocol doit valoir ${PROTOCOLS.join(" ou ")}` })
  protocol!: IngressProtocol;
}
