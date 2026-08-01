import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { Response } from "express";
import { SessionAuthGuard } from "../auth/session-auth.guard";
import { RolesGuard } from "../auth/roles.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import { SessionUser } from "../auth/session.types";
import { RoomAccessGuard, RequireRoomAccess } from "../rooms/room-access.guard";
import { EnrollmentsService } from "./enrollments.service";
import { EnrollUserDto } from "./dto/enroll-user.dto";

// Même plafond que l'import d'utilisateurs (users.controller.ts) : 2 Mio
// couvrent très largement une promotion, un fichier plus gros signale une erreur
// de dépôt plutôt qu'un besoin réel.
const MAX_CSV_UPLOAD_BYTES = 2 * 1024 * 1024;

// Réservé au créateur de la salle, à un co-modérateur inscrit, ou à un admin
// (RequireRoomAccess + RoomAccessGuard, voir EnrollmentsService.canManageRoom) —
// même patron que attendance.controller.ts.
@Controller("rooms/:roomId/enrollments")
@UseGuards(SessionAuthGuard, RolesGuard, RoomAccessGuard)
export class EnrollmentsController {
  constructor(private readonly enrollments: EnrollmentsService) {}

  @Get()
  @RequireRoomAccess()
  list(@Param("roomId") roomId: string) {
    return this.enrollments.list(roomId);
  }

  @Post()
  @RequireRoomAccess()
  enroll(@Param("roomId") roomId: string, @Body() dto: EnrollUserDto, @CurrentUser() user: SessionUser) {
    return this.enrollments.enroll(roomId, dto.userId, user.id);
  }

  // Placé AVANT la route paramétrée ":userId" du Delete plus bas n'a pas
  // d'importance (méthodes HTTP différentes), mais le rester avant tout futur
  // GET ":userId" en aurait : "csv-template" serait alors pris pour un userId.
  @Get("csv-template")
  @RequireRoomAccess()
  csvTemplate(@Res() res: Response) {
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="modele-inscriptions.csv"');
    res.send(this.enrollments.csvTemplate());
  }

  @Post("import-csv")
  @RequireRoomAccess()
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: MAX_CSV_UPLOAD_BYTES } }))
  importCsv(
    @Param("roomId") roomId: string,
    @UploadedFile() file: { buffer: Buffer } | undefined,
    @CurrentUser() user: SessionUser
  ) {
    if (!file) throw new BadRequestException("Aucun fichier reçu");
    return this.enrollments.importFromCsv(roomId, file.buffer.toString("utf-8"), user.id);
  }

  @Delete(":userId")
  @RequireRoomAccess()
  @HttpCode(204)
  unenroll(@Param("roomId") roomId: string, @Param("userId") userId: string): Promise<void> {
    return this.enrollments.unenroll(roomId, userId);
  }
}
