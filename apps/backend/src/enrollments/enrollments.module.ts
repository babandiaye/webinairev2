import { Global, Module } from "@nestjs/common";
import { EnrollmentsController } from "./enrollments.controller";
import { EnrollmentsService } from "./enrollments.service";

// Global (même patron que PrismaModule) : RoomAccessGuard va dépendre de
// EnrollmentsService, et ce guard est aujourd'hui instancié dans une dizaine de
// modules différents (voir room-access.guard.ts) sans jamais s'importer les uns
// les autres — le rendre global évite de devoir toucher chacun d'eux.
@Global()
@Module({
  controllers: [EnrollmentsController],
  providers: [EnrollmentsService],
  exports: [EnrollmentsService],
})
export class EnrollmentsModule {}
