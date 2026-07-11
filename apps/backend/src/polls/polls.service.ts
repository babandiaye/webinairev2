import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { Poll, PollOption, PollResponse, PollStatus } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { CreatePollDto, PollDto } from "@webinairev2/shared-types";

type PollWithOptions = Poll & { options: (PollOption & { responses: PollResponse[] })[] };

@Injectable()
export class PollsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(roomId: string, userId: string): Promise<PollDto[]> {
    const polls = await this.prisma.poll.findMany({
      where: { roomId },
      include: { options: { include: { responses: true } } },
      orderBy: { createdAt: "desc" },
    });
    return polls.map((p) => this.toDto(p, userId));
  }

  async create(roomId: string, creatorId: string, dto: CreatePollDto): Promise<PollDto> {
    const poll = await this.prisma.poll.create({
      data: {
        roomId,
        question: dto.question,
        multiple: !!dto.multiple,
        createdBy: creatorId,
        options: { create: dto.options.map((label) => ({ label })) },
      },
      include: { options: { include: { responses: true } } },
    });
    return this.toDto(poll, creatorId);
  }

  async open(roomId: string, pollId: string): Promise<void> {
    const poll = await this.findOrThrow(roomId, pollId);
    if (poll.status !== PollStatus.DRAFT) {
      throw new BadRequestException("Ce sondage a déjà été ouvert");
    }
    await this.prisma.poll.update({ where: { id: pollId }, data: { status: PollStatus.OPEN } });
  }

  async close(roomId: string, pollId: string): Promise<void> {
    const poll = await this.findOrThrow(roomId, pollId);
    if (poll.status !== PollStatus.OPEN) {
      throw new BadRequestException("Ce sondage n'est pas ouvert");
    }
    await this.prisma.poll.update({
      where: { id: pollId },
      data: { status: PollStatus.CLOSED, closedAt: new Date() },
    });
  }

  async vote(roomId: string, pollId: string, userId: string, optionIds: string[]): Promise<void> {
    const poll = await this.prisma.poll.findUnique({ where: { id: pollId }, include: { options: true } });
    if (!poll || poll.roomId !== roomId) throw new NotFoundException("Sondage introuvable");
    if (poll.status !== PollStatus.OPEN) throw new BadRequestException("Ce sondage n'est pas ouvert au vote");

    const validIds = new Set(poll.options.map((o) => o.id));
    if (optionIds.some((id) => !validIds.has(id))) {
      throw new BadRequestException("Options de vote invalides");
    }
    if (!poll.multiple && optionIds.length > 1) {
      throw new BadRequestException("Ce sondage n'accepte qu'une seule réponse");
    }

    // Un revote remplace entièrement le(s) choix précédent(s) de l'utilisateur sur ce
    // sondage, plutôt que de les cumuler (comportement attendu d'un sondage, pas d'un log).
    await this.prisma.pollResponse.deleteMany({ where: { identity: userId, pollOption: { pollId } } });
    await this.prisma.pollResponse.createMany({
      data: optionIds.map((pollOptionId) => ({ pollOptionId, identity: userId })),
    });
  }

  private async findOrThrow(roomId: string, pollId: string): Promise<Poll> {
    const poll = await this.prisma.poll.findUnique({ where: { id: pollId } });
    if (!poll || poll.roomId !== roomId) throw new NotFoundException("Sondage introuvable");
    return poll;
  }

  private toDto(poll: PollWithOptions, userId: string): PollDto {
    return {
      id: poll.id,
      roomId: poll.roomId,
      question: poll.question,
      status: poll.status,
      multiple: poll.multiple,
      createdAt: poll.createdAt.toISOString(),
      options: poll.options.map((o) => ({
        id: o.id,
        label: o.label,
        voteCount: o.responses.length,
        votedByMe: o.responses.some((r) => r.identity === userId),
      })),
    };
  }
}
