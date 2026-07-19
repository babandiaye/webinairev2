import { Controller, Get, UseGuards } from "@nestjs/common";
import { Role } from "@prisma/client";
import { SystemStatusDto } from "@webinairev2/shared-types";
import { SessionAuthGuard } from "../auth/session-auth.guard";
import { RolesGuard } from "../auth/roles.guard";
import { RequireRole } from "../auth/roles.decorator";
import { StatusService } from "./status.service";

@Controller("status")
@UseGuards(SessionAuthGuard, RolesGuard)
export class StatusController {
  constructor(private readonly statusService: StatusService) {}

  @Get()
  @RequireRole(Role.ADMIN)
  getStatus(): Promise<SystemStatusDto> {
    return this.statusService.getStatus();
  }
}
