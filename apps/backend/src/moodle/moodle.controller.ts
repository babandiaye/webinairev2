import { Body, Controller, Delete, Get, Param, Post, Query, UseGuards } from "@nestjs/common";
import { MoodleApiKeyGuard } from "./moodle-api-key.guard";
import { MoodleService } from "./moodle.service";
import { CreateMoodleRoomDto } from "./dto/create-moodle-room.dto";
import { SyncMoodleUserDto } from "./dto/sync-moodle-user.dto";

// Consommé uniquement par le plugin Moodle mod_webinairev2 (classes/api.php),
// serveur-à-serveur — jamais par le frontend SPA ni par un navigateur directement.
// Voir MoodleApiKeyGuard pour le modèle d'autorisation (clé statique, pas de session).
@Controller("moodle")
@UseGuards(MoodleApiKeyGuard)
export class MoodleController {
  constructor(private readonly moodle: MoodleService) {}

  @Post("rooms")
  createRoom(@Body() dto: CreateMoodleRoomDto) {
    return this.moodle.createRoom(dto);
  }

  @Get("rooms/:roomId/status")
  getStatus(@Param("roomId") roomId: string) {
    return this.moodle.getStatus(roomId);
  }

  // Réponse paginée { recordings, total, page, perPage } — le plugin Moodle
  // (classes/api.php) accepte aussi l'ancienne forme "tableau nu" pour qu'une
  // version antérieure du plugin, encore installée le temps d'un déploiement,
  // ne casse pas.
  @Get("rooms/:roomId/recordings")
  listRecordings(
    @Param("roomId") roomId: string,
    @Query("page") page?: string,
    @Query("perPage") perPage?: string
  ) {
    return this.moodle.listRecordings(
      roomId,
      page ? Number(page) : undefined,
      perPage ? Number(perPage) : undefined
    );
  }

  @Delete("rooms/:roomId/recordings/:recordingId")
  async deleteRecording(@Param("roomId") roomId: string, @Param("recordingId") recordingId: string) {
    await this.moodle.deleteRecording(roomId, recordingId);
    return { ok: true };
  }

  @Post("users/sync")
  syncUser(@Body() dto: SyncMoodleUserDto) {
    return this.moodle.syncUser(dto);
  }
}
