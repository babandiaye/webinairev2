import { Body, Controller, Get, Param, Patch, UseGuards } from "@nestjs/common";
import { Role } from "@prisma/client";
import { SessionAuthGuard } from "../auth/session-auth.guard";
import { RolesGuard } from "../auth/roles.guard";
import { RequireRole } from "../auth/roles.decorator";
import { CurrentUser } from "../auth/current-user.decorator";
import { SessionUser } from "../auth/session.types";
import { UserDto } from "@webinairev2/shared-types";
import { UsersService } from "./users.service";
import { UpdateRoleDto } from "./dto/update-role.dto";

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
  list(): Promise<UserDto[]> {
    return this.usersService.list();
  }

  @Patch(":id/role")
  @RequireRole(Role.ADMIN)
  updateRole(
    @Param("id") id: string,
    @Body() dto: UpdateRoleDto,
    @CurrentUser() requester: SessionUser
  ): Promise<UserDto> {
    return this.usersService.updateRole(id, dto.role, requester.id);
  }
}
