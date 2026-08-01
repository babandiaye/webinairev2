import { Body, Controller, Get, Param, Post, UseGuards } from "@nestjs/common";
import { SessionAuthGuard } from "../auth/session-auth.guard";
import { RolesGuard } from "../auth/roles.guard";
import { RoomAccessGuard, RequireRoomAccess, RequireRoomView } from "../rooms/room-access.guard";
import { CurrentUser } from "../auth/current-user.decorator";
import { SessionUser } from "../auth/session.types";
import { PollsService } from "./polls.service";
import { CreatePollDto } from "./dto/create-poll.dto";
import { VotePollDto } from "./dto/vote-poll.dto";

@Controller("rooms/:roomId/polls")
@UseGuards(SessionAuthGuard, RolesGuard, RoomAccessGuard)
export class PollsController {
  constructor(private readonly polls: PollsService) {}

  @Get()
  @RequireRoomView()
  list(@Param("roomId") roomId: string, @CurrentUser() user: SessionUser) {
    return this.polls.list(roomId, user.id);
  }

  // RequireRoomAccess seul (créateur de la salle ou ADMIN) : ajouter en plus
  // RequireRole(ADMIN, MODERATOR) créait un cas incohérent — un créateur de
  // salle rétrogradé en VIEWER après coup (via /admin/users) perdrait le droit
  // de créer un sondage dans SA PROPRE salle, alors que toutes les autres
  // actions de créateur (enregistrement, sous-groupes, tableau blanc...) ne
  // dépendent que de RequireRoomAccess, jamais du rôle global courant.
  @Post()
  @RequireRoomAccess()
  create(@Param("roomId") roomId: string, @Body() dto: CreatePollDto, @CurrentUser() user: SessionUser) {
    return this.polls.create(roomId, user.id, dto);
  }

  @Post(":pollId/open")
  @RequireRoomAccess()
  async open(@Param("roomId") roomId: string, @Param("pollId") pollId: string) {
    await this.polls.open(roomId, pollId);
    return { ok: true };
  }

  @Post(":pollId/close")
  @RequireRoomAccess()
  async close(@Param("roomId") roomId: string, @Param("pollId") pollId: string) {
    await this.polls.close(roomId, pollId);
    return { ok: true };
  }

  // Voter est ouvert aux simples inscrits (RequireRoomView, pas
  // RequireRoomAccess) — mais PAS à n'importe quel utilisateur authentifié de
  // la plateforme, comme c'était le cas avant : cette route était la seule
  // action mutante liée à une salle sans aucun contrôle d'accès.
  @Post(":pollId/vote")
  @RequireRoomView()
  async vote(
    @Param("roomId") roomId: string,
    @Param("pollId") pollId: string,
    @Body() dto: VotePollDto,
    @CurrentUser() user: SessionUser
  ) {
    await this.polls.vote(roomId, pollId, user.id, dto.optionIds);
    return { ok: true };
  }
}
