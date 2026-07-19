import { Module } from "@nestjs/common";
import { LiveKitWebhookController } from "./livekit-webhook.controller";
import { LiveKitModule } from "../livekit/livekit.module";
import { RecordingsModule } from "../recordings/recordings.module";
import { AttendanceModule } from "../attendance/attendance.module";
import { WebhookHealthService } from "./webhook-health.service";

@Module({
  imports: [LiveKitModule, RecordingsModule, AttendanceModule],
  controllers: [LiveKitWebhookController],
  providers: [WebhookHealthService],
  exports: [WebhookHealthService],
})
export class WebhooksModule {}
