import { BadRequestException, Controller, Get, Query, UseGuards } from "@nestjs/common";
import { ActivityStatsDto, StatsRange } from "@webinairev2/shared-types";
import { SessionAuthGuard } from "../auth/session-auth.guard";
import { StatsService } from "./stats.service";

const VALID_RANGES: StatsRange[] = ["week", "month", "year"];

// Pas de RequireRole ici : ces agrégats (cours/sessions/durée enregistrée) sont
// du même ordre que "Salles totales" sur le tableau de bord, déjà visible de
// tous les rôles authentifiés (RoomsService.list() ne filtre pas par rôle) —
// pas réservés ADMIN comme les raccourcis vers /admin/users ou /recordings.
@Controller("stats")
@UseGuards(SessionAuthGuard)
export class StatsController {
  constructor(private readonly statsService: StatsService) {}

  @Get("activity")
  getActivity(@Query("range") range?: string): Promise<ActivityStatsDto> {
    const r = (range ?? "week") as StatsRange;
    if (!VALID_RANGES.includes(r)) {
      throw new BadRequestException(`range doit être ${VALID_RANGES.map((v) => `"${v}"`).join(", ")}`);
    }
    return this.statsService.getActivity(r);
  }
}
