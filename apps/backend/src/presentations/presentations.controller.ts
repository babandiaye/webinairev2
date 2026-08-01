import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Put,
  Query,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { Response } from "express";
import { ConfigService } from "@nestjs/config";
import { SessionAuthGuard } from "../auth/session-auth.guard";
import { RolesGuard } from "../auth/roles.guard";
import { RoomAccessGuard, RequireRoomAccess, RequireRoomView } from "../rooms/room-access.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import { SessionUser } from "../auth/session.types";
import { PresentationsService, UploadedPdfFile } from "./presentations.service";
import { SetCurrentSlideDto } from "./dto/set-current-slide.dto";
import { S3Service } from "../storage/s3.service";
import { verifyDownloadToken } from "../common/download-token.util";

const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

@Controller("rooms/:roomId/presentations")
@UseGuards(SessionAuthGuard, RolesGuard, RoomAccessGuard)
export class PresentationsController {
  constructor(private readonly presentations: PresentationsService) {}

  @Get()
  @RequireRoomView()
  list(@Param("roomId") roomId: string) {
    return this.presentations.list(roomId);
  }

  @Get("active")
  @RequireRoomView()
  active(@Param("roomId") roomId: string) {
    return this.presentations.getActive(roomId);
  }

  @Get(":id")
  @RequireRoomView()
  getOne(@Param("roomId") roomId: string, @Param("id") id: string) {
    return this.presentations.getOne(roomId, id);
  }

  // RequireRoomAccess seul : voir le commentaire équivalent dans
  // polls.controller.ts (RequireRole en plus créait un cas incohérent pour un
  // créateur de salle rétrogradé après coup).
  @Post()
  @RequireRoomAccess()
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: MAX_UPLOAD_BYTES } }))
  upload(
    @Param("roomId") roomId: string,
    @UploadedFile() file: UploadedPdfFile | undefined,
    @CurrentUser() user: SessionUser
  ) {
    if (!file) throw new BadRequestException("Aucun fichier reçu");
    return this.presentations.upload(roomId, user.id, file);
  }

  @Post(":id/activate")
  @RequireRoomAccess()
  async activate(@Param("roomId") roomId: string, @Param("id") id: string) {
    await this.presentations.activate(roomId, id);
    return { ok: true };
  }

  @Post("deactivate")
  @RequireRoomAccess()
  async deactivate(@Param("roomId") roomId: string) {
    await this.presentations.deactivate(roomId);
    return { ok: true };
  }

  @Put(":id/current-slide")
  @RequireRoomAccess()
  async setCurrentSlide(
    @Param("roomId") roomId: string,
    @Param("id") id: string,
    @Body() dto: SetCurrentSlideDto
  ) {
    await this.presentations.setCurrentSlide(roomId, id, dto);
    return { ok: true };
  }
}

// Pas de SessionAuthGuard : l'autorisation est portée par le token HMAC signé et
// expirant généré dans PresentationsService.toDto() (même modèle que les liens de
// téléchargement d'enregistrement — jamais d'URL S3 exposée directement).
@Controller("presentations/slides")
export class PresentationSlidesController {
  constructor(
    private readonly s3: S3Service,
    private readonly config: ConfigService
  ) {}

  @Get("image")
  async image(@Query("token") token: string, @Res() res: Response) {
    const payload = verifyDownloadToken(token, this.config.get<string>("secrets.downloadLink")!);
    if (!payload) throw new BadRequestException("Lien d'image invalide ou expiré");

    const object = await this.s3.getObjectStream(payload.resourceId);
    res.setHeader("Content-Type", object.ContentType ?? "image/png");
    if (object.ContentLength) res.setHeader("Content-Length", object.ContentLength.toString());

    const body = object.Body as NodeJS.ReadableStream;
    body.pipe(res);
  }
}
