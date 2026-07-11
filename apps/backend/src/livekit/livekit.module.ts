import { Module } from "@nestjs/common";
import { LiveKitClientsService } from "./livekit-clients.service";
import { LiveKitTokenService } from "./livekit-token.service";

@Module({
  providers: [LiveKitClientsService, LiveKitTokenService],
  exports: [LiveKitClientsService, LiveKitTokenService],
})
export class LiveKitModule {}
