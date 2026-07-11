import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { WhiteboardSnapshotDto } from "@webinairev2/shared-types";

@Injectable()
export class WhiteboardService {
  constructor(private readonly prisma: PrismaService) {}

  async get(roomId: string): Promise<WhiteboardSnapshotDto> {
    const snapshot = await this.prisma.whiteboardSnapshot.findUnique({ where: { roomId } });
    return { sceneData: snapshot?.sceneData ?? null };
  }

  async save(roomId: string, sceneData: unknown): Promise<void> {
    const room = await this.prisma.room.findUnique({ where: { id: roomId } });
    if (!room) throw new NotFoundException("Salle introuvable");

    await this.prisma.whiteboardSnapshot.upsert({
      where: { roomId },
      create: { roomId, sceneData: sceneData as any },
      update: { sceneData: sceneData as any },
    });
  }

  async getOpenState(roomId: string): Promise<{ open: boolean }> {
    const room = await this.prisma.room.findUnique({ where: { id: roomId } });
    if (!room) throw new NotFoundException("Salle introuvable");
    return { open: room.whiteboardOpen };
  }

  async setOpenState(roomId: string, open: boolean): Promise<void> {
    await this.prisma.room.update({ where: { id: roomId }, data: { whiteboardOpen: open } });
  }
}
