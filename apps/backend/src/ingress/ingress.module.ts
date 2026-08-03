import { Module } from "@nestjs/common";
import { IngressController } from "./ingress.controller";
import { IngressService } from "./ingress.service";
import { LiveKitModule } from "../livekit/livekit.module";
import { RoomAccessGuard } from "../rooms/room-access.guard";

// exports: RoomsService supprime l'ingress de la salle à sa clôture et à sa
// suppression. La dépendance ne va que dans ce sens (RoomsModule importe
// IngressModule) — IngressService résout roomId → roomName via Prisma
// directement, justement pour ne pas dépendre de RoomsService en retour.
@Module({
  imports: [LiveKitModule],
  controllers: [IngressController],
  providers: [IngressService, RoomAccessGuard],
  exports: [IngressService],
})
export class IngressModule {}
