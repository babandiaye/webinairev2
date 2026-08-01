import {
  BadRequestException,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Param,
  Post,
  Query,
  Res,
  UseGuards,
} from "@nestjs/common";
import { Response } from "express";
import { ConfigService } from "@nestjs/config";
import { SessionAuthGuard } from "../auth/session-auth.guard";
import { RolesGuard } from "../auth/roles.guard";
import { RequireRole } from "../auth/roles.decorator";
import { CurrentUser } from "../auth/current-user.decorator";
import { SessionUser } from "../auth/session.types";
import { RoomAccessGuard, RequireRoomAccess, RequireRoomView } from "../rooms/room-access.guard";
import { RecordingsService } from "./recordings.service";
import { PrismaService } from "../prisma/prisma.service";
import { S3Service } from "../storage/s3.service";
import { verifyDownloadToken } from "../common/download-token.util";
import { RecordingStatus, Role } from "@prisma/client";

@Controller("rooms/:roomId/recordings")
@UseGuards(SessionAuthGuard, RolesGuard, RoomAccessGuard)
export class RoomRecordingsController {
  constructor(private readonly recordings: RecordingsService) {}

  @Get()
  @RequireRoomView()
  list(@Param("roomId") roomId: string) {
    return this.recordings.list(roomId);
  }

  @Post("start")
  @RequireRoomAccess()
  start(@Param("roomId") roomId: string) {
    return this.recordings.start(roomId);
  }

  @Post("stop")
  @RequireRoomAccess()
  stop(@Param("roomId") roomId: string) {
    return this.recordings.stop(roomId);
  }

  @Delete(":id")
  @RequireRoomAccess()
  @HttpCode(204)
  remove(@Param("roomId") roomId: string, @Param("id") id: string) {
    return this.recordings.remove(roomId, id);
  }
}

@Controller("recordings")
export class RecordingsController {
  constructor(
    private readonly recordings: RecordingsService,
    private readonly prisma: PrismaService,
    private readonly s3: S3Service,
    private readonly config: ConfigService
  ) {}

  // Toutes salles confondues — réservé ADMIN (les modérateurs/créateurs de salle
  // gardent leur propre vue filtrée via RoomRecordingsController.list()).
  @Get()
  @UseGuards(SessionAuthGuard, RolesGuard)
  @RequireRole(Role.ADMIN)
  listAll() {
    return this.recordings.listAll();
  }

  @Get(":id/url")
  @UseGuards(SessionAuthGuard)
  getDownloadLink(@Param("id") id: string, @CurrentUser() user: SessionUser) {
    return this.recordings.getDownloadLink(id, user);
  }

  // Pas de SessionAuthGuard ici : l'autorisation est portée par le token HMAC signé
  // et expirant (obtenu via /recordings/:id/url), pas par la session — permet un
  // téléchargement OU une lecture directe par le navigateur (nouvel onglet, lecteur
  // vidéo <video>) sans dépendre du cookie de session sur cette requête précise.
  // ?inline=1 -> Content-Disposition inline (lecture dans le lecteur <video> plutôt
  // que téléchargement forcé) ; le header Range est relayé pour permettre le seek.
  @Get("download")
  async download(
    @Query("token") token: string,
    @Query("inline") inline: string | undefined,
    @Headers("range") range: string | undefined,
    @Res() res: Response
  ) {
    const payload = verifyDownloadToken(token, this.config.get<string>("secrets.downloadLink")!);
    if (!payload) throw new BadRequestException("Lien de téléchargement invalide ou expiré");

    const recording = await this.prisma.recording.findUnique({
      where: { id: payload.resourceId },
    });
    if (!recording || recording.status !== RecordingStatus.READY || !recording.s3Key) {
      throw new BadRequestException("Enregistrement indisponible");
    }

    const object = await this.s3.getObjectStream(recording.s3Key, range);
    res.setHeader("Content-Type", object.ContentType ?? "video/mp4");
    res.setHeader("Accept-Ranges", "bytes");
    res.setHeader(
      "Content-Disposition",
      `${inline ? "inline" : "attachment"}; filename="${recording.filename}"`
    );
    if (object.ContentLength) res.setHeader("Content-Length", object.ContentLength.toString());

    if (object.ContentRange) {
      res.status(206);
      res.setHeader("Content-Range", object.ContentRange);
    }

    const body = object.Body as NodeJS.ReadableStream;
    body.pipe(res);
  }
}
