import { Module } from "@nestjs/common";
import { MoodleController } from "./moodle.controller";
import { MoodleService } from "./moodle.service";
import { MoodleApiKeyGuard } from "./moodle-api-key.guard";
import { LiveKitModule } from "../livekit/livekit.module";
import { RecordingsModule } from "../recordings/recordings.module";

@Module({
  imports: [LiveKitModule, RecordingsModule],
  controllers: [MoodleController],
  providers: [MoodleService, MoodleApiKeyGuard],
})
export class MoodleModule {}
