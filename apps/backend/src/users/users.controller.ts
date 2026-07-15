import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { Response } from "express";
import { Role } from "@prisma/client";
import { SessionAuthGuard } from "../auth/session-auth.guard";
import { RolesGuard } from "../auth/roles.guard";
import { RequireRole } from "../auth/roles.decorator";
import { CurrentUser } from "../auth/current-user.decorator";
import { SessionUser } from "../auth/session.types";
import { AdminUserDto, CsvImportSummaryDto, UserDto } from "@webinairev2/shared-types";
import { UsersService } from "./users.service";
import { UpdateRoleDto } from "./dto/update-role.dto";
import { SetActiveDto } from "./dto/set-active.dto";
import { CreateUserDto } from "./dto/create-user.dto";

const MAX_CSV_UPLOAD_BYTES = 2 * 1024 * 1024;

@Controller("users")
@UseGuards(SessionAuthGuard, RolesGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get("me")
  me(@CurrentUser() user: SessionUser): UserDto {
    return user;
  }

  @Get()
  @RequireRole(Role.ADMIN)
  list(): Promise<AdminUserDto[]> {
    return this.usersService.list();
  }

  @Post()
  @RequireRole(Role.ADMIN)
  create(@Body() dto: CreateUserDto): Promise<AdminUserDto> {
    return this.usersService.createManual(dto);
  }

  @Get("csv-template")
  @RequireRole(Role.ADMIN)
  csvTemplate(@Res() res: Response) {
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="modele-utilisateurs.csv"');
    res.send(this.usersService.csvTemplate());
  }

  @Post("import-csv")
  @RequireRole(Role.ADMIN)
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: MAX_CSV_UPLOAD_BYTES } }))
  importCsv(@UploadedFile() file: { buffer: Buffer } | undefined): Promise<CsvImportSummaryDto> {
    if (!file) throw new BadRequestException("Aucun fichier reçu");
    return this.usersService.importFromCsv(file.buffer.toString("utf-8"));
  }

  @Patch(":id/role")
  @RequireRole(Role.ADMIN)
  updateRole(
    @Param("id") id: string,
    @Body() dto: UpdateRoleDto,
    @CurrentUser() requester: SessionUser
  ): Promise<AdminUserDto> {
    return this.usersService.updateRole(id, dto.role, requester.id);
  }

  @Patch(":id/active")
  @RequireRole(Role.ADMIN)
  setActive(
    @Param("id") id: string,
    @Body() dto: SetActiveDto,
    @CurrentUser() requester: SessionUser
  ): Promise<AdminUserDto> {
    return this.usersService.setActive(id, dto.active, requester.id);
  }

  @Delete(":id")
  @RequireRole(Role.ADMIN)
  @HttpCode(204)
  remove(@Param("id") id: string, @CurrentUser() requester: SessionUser): Promise<void> {
    return this.usersService.remove(id, requester.id);
  }
}
