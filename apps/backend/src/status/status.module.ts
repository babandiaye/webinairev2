import { Module } from "@nestjs/common";
import { LiveKitModule } from "../livekit/livekit.module";
import { StorageModule } from "../storage/storage.module";
import { WebhooksModule } from "../webhooks/webhooks.module";
import { StatusController } from "./status.controller";
import { StatusService } from "./status.service";

@Module({
  imports: [LiveKitModule, StorageModule, WebhooksModule],
  controllers: [StatusController],
  providers: [StatusService],
})
export class StatusModule {}
