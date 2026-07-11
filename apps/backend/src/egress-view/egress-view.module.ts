import { Module } from "@nestjs/common";
import { EgressViewController } from "./egress-view.controller";
import { EgressTokenGuard } from "./egress-token.guard";
import { LiveKitModule } from "../livekit/livekit.module";
import { WhiteboardModule } from "../whiteboard/whiteboard.module";
import { PresentationsModule } from "../presentations/presentations.module";

@Module({
  imports: [LiveKitModule, WhiteboardModule, PresentationsModule],
  controllers: [EgressViewController],
  providers: [EgressTokenGuard],
})
export class EgressViewModule {}
