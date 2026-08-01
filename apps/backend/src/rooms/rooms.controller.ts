import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, UseGuards } from "@nestjs/common";
import { Role } from "@prisma/client";
import { SessionAuthGuard } from "../auth/session-auth.guard";
import { RolesGuard } from "../auth/roles.guard";
import { RequireRole } from "../auth/roles.decorator";
import { CurrentUser } from "../auth/current-user.decorator";
import { SessionUser } from "../auth/session.types";
import { RoomAccessGuard, RequireRoomAccess } from "./room-access.guard";
import { RoomsService } from "./rooms.service";
import { CreateRoomDto } from "./dto/create-room.dto";
import { SetParticipantPermissionDto } from "./dto/set-participant-permission.dto";
import { UpdateRoomSettingsDto } from "./dto/update-room-settings.dto";

@Controller("rooms")
@UseGuards(SessionAuthGuard, RolesGuard, RoomAccessGuard)
export class RoomsController {
  constructor(private readonly rooms: RoomsService) {}

  @Get()
  list(@CurrentUser() user: SessionUser) {
    return this.rooms.list(user);
  }

  @Post()
  @RequireRole(Role.ADMIN, Role.MODERATOR)
  create(@Body() dto: CreateRoomDto, @CurrentUser() user: SessionUser) {
    return this.rooms.create(dto.title, user);
  }

  @Get(":id")
  findOne(@Param("id") id: string, @CurrentUser() user: SessionUser) {
    return this.rooms.findOne(id, user);
  }

  @Post(":id/join")
  join(@Param("id") id: string, @CurrentUser() user: SessionUser) {
    return this.rooms.join(id, user);
  }

  @Post(":id/close")
  @RequireRoomAccess()
  close(@Param("id") id: string) {
    return this.rooms.close(id);
  }

  @Patch(":id/settings")
  @RequireRoomAccess()
  updateSettings(@Param("id") id: string, @Body() dto: UpdateRoomSettingsDto) {
    return this.rooms.updateSettings(id, dto);
  }

  @Delete(":id")
  @RequireRoomAccess()
  @HttpCode(204)
  remove(@Param("id") id: string): Promise<void> {
    return this.rooms.remove(id);
  }

  @Post(":id/participants/:identity/mute")
  @RequireRoomAccess()
  async muteParticipant(@Param("id") id: string, @Param("identity") identity: string) {
    await this.rooms.muteParticipant(id, identity);
    return { ok: true };
  }

  @Post(":id/participants/:identity/remove")
  @RequireRoomAccess()
  async removeParticipant(@Param("id") id: string, @Param("identity") identity: string) {
    await this.rooms.removeParticipant(id, identity);
    return { ok: true };
  }

  @Post(":id/participants/:identity/speaker")
  @RequireRoomAccess()
  async setSpeakerPermission(
    @Param("id") id: string,
    @Param("identity") identity: string,
    @Body() dto: SetParticipantPermissionDto
  ) {
    await this.rooms.setSpeakerPermission(id, identity, dto.grant);
    return { ok: true };
  }

  @Post(":id/participants/:identity/presenter")
  @RequireRoomAccess()
  async setPresenterPermission(
    @Param("id") id: string,
    @Param("identity") identity: string,
    @Body() dto: SetParticipantPermissionDto
  ) {
    await this.rooms.setPresenterPermission(id, identity, dto.grant);
    return { ok: true };
  }

  @Post(":id/mute-all")
  @RequireRoomAccess()
  async muteAll(@Param("id") id: string) {
    await this.rooms.muteAllParticipants(id);
    return { ok: true };
  }

  @Post(":id/mute-all-cameras")
  @RequireRoomAccess()
  async muteAllCameras(@Param("id") id: string) {
    await this.rooms.muteAllCameras(id);
    return { ok: true };
  }
}
