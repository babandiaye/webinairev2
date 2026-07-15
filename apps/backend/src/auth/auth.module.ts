import { Module } from "@nestjs/common";
import { AuthController } from "./auth.controller";
import { OidcClientService } from "./oidc-client.service";
import { UserSyncService } from "./user-sync.service";
import { SessionAuthGuard } from "./session-auth.guard";
import { RolesGuard } from "./roles.guard";
import { SessionStoreService } from "./session-store.service";

@Module({
  controllers: [AuthController],
  providers: [OidcClientService, UserSyncService, SessionAuthGuard, RolesGuard, SessionStoreService],
  exports: [OidcClientService, UserSyncService, SessionAuthGuard, RolesGuard, SessionStoreService],
})
export class AuthModule {}
