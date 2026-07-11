import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { ScheduleModule } from "@nestjs/schedule";
import configuration from "./config/configuration";
import { validateEnv } from "./config/env.validation";
import { PrismaModule } from "./prisma/prisma.module";
import { AuthModule } from "./auth/auth.module";
import { UsersModule } from "./users/users.module";
import { RoomsModule } from "./rooms/rooms.module";
import { BreakoutRoomsModule } from "./breakout-rooms/breakout-rooms.module";
import { WhiteboardModule } from "./whiteboard/whiteboard.module";
import { PollsModule } from "./polls/polls.module";
import { PresentationsModule } from "./presentations/presentations.module";
import { RecordingsModule } from "./recordings/recordings.module";
import { EgressViewModule } from "./egress-view/egress-view.module";
import { WebhooksModule } from "./webhooks/webhooks.module";
import { HealthModule } from "./health/health.module";
import { MoodleModule } from "./moodle/moodle.module";
import { AttendanceModule } from "./attendance/attendance.module";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [configuration], validate: validateEnv }),
    ScheduleModule.forRoot(),
    PrismaModule,
    AuthModule,
    UsersModule,
    RoomsModule,
    BreakoutRoomsModule,
    WhiteboardModule,
    PollsModule,
    PresentationsModule,
    RecordingsModule,
    EgressViewModule,
    WebhooksModule,
    HealthModule,
    MoodleModule,
    AttendanceModule,
  ],
})
export class AppModule {}
