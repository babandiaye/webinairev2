import { execFile } from "child_process";
import { promisify } from "util";
import { mkdtemp, readFile, readdir, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { BadRequestException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PresentationStatus } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { S3Service } from "../storage/s3.service";
import { PresentationDto, SetCurrentSlideDto } from "@webinairev2/shared-types";
import { signDownloadToken } from "../common/download-token.util";

const execFileAsync = promisify(execFile);
const SLIDE_LINK_TTL_SECONDS = 60 * 60; // durée d'une session de présentation raisonnable

// Au-delà, une conversion encore CONVERTING ne peut plus être qu'un orphelin
// (processus perdu au redémarrage) : une conversion réelle de PDF, même
// volumineux, se compte en dizaines de secondes.
const STUCK_CONVERSION_THRESHOLD_MS = 10 * 60 * 1000;

// Évite une dépendance directe sur @types/multer (non installé) : on ne consomme
// que la forme du fichier réellement utilisée, fournie en mémoire par multer.
export interface UploadedPdfFile {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
}

@Injectable()
export class PresentationsService {
  private readonly logger = new Logger(PresentationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly s3: S3Service,
    private readonly config: ConfigService
  ) {}

  async upload(roomId: string, uploaderId: string, file: UploadedPdfFile): Promise<PresentationDto> {
    if (file.mimetype !== "application/pdf") {
      throw new BadRequestException("Seuls les fichiers PDF sont acceptés");
    }

    const presentation = await this.prisma.presentation.create({
      data: { roomId, filename: file.originalname, uploadedBy: uploaderId, status: PresentationStatus.UPLOADED },
    });

    // Conversion en tâche de fond : le client reçoit UPLOADED immédiatement et
    // suit la progression (CONVERTING → READY/FAILED) par polling REST — pas
    // besoin d'une file BullMQ dédiée pour une conversion PDF, généralement rapide.
    this.convert(presentation.id, file.buffer).catch((err) =>
      this.logger.error(`Échec de conversion de la présentation ${presentation.id}`, err)
    );

    return this.toDto({ ...presentation, slides: [] });
  }

  private async convert(presentationId: string, pdfBuffer: Buffer): Promise<void> {
    await this.prisma.presentation.update({
      where: { id: presentationId },
      data: { status: PresentationStatus.CONVERTING },
    });

    const workDir = await mkdtemp(join(tmpdir(), "webinairev2-slides-"));
    try {
      const pdfPath = join(workDir, "input.pdf");
      await writeFile(pdfPath, pdfBuffer);

      const outputPrefix = join(workDir, "slide");
      // -r 120 : résolution raisonnable pour un affichage plein écran sans fichiers énormes.
      await execFileAsync("pdftoppm", ["-png", "-r", "120", pdfPath, outputPrefix]);

      const files = (await readdir(workDir)).filter((f) => f.startsWith("slide-")).sort();
      if (files.length === 0) {
        throw new Error("pdftoppm n'a produit aucune image (PDF vide ou invalide)");
      }

      // Upload par lots en parallèle plutôt qu'une diapositive à la fois : pdftoppm
      // lui-même est rapide, le vrai goulot d'étranglement était l'aller-retour
      // réseau MinIO répété séquentiellement (N × latence au lieu de N/lot × latence).
      const UPLOAD_CONCURRENCY = 6;
      const slideRecords: { presentationId: string; index: number; s3Key: string }[] = [];
      for (let start = 0; start < files.length; start += UPLOAD_CONCURRENCY) {
        const batch = files.slice(start, start + UPLOAD_CONCURRENCY);
        await Promise.all(
          batch.map(async (filename, offset) => {
            const i = start + offset;
            const buffer = await readFile(join(workDir, filename));
            const key = `presentations/${presentationId}/slide-${i + 1}.png`;
            await this.s3.putObject(key, buffer, "image/png");
            slideRecords.push({ presentationId, index: i, s3Key: key });
          })
        );
      }
      // Un seul aller-retour DB pour toutes les diapositives plutôt qu'un INSERT
      // séquentiel par diapositive.
      await this.prisma.presentationSlide.createMany({ data: slideRecords });

      await this.prisma.presentation.update({
        where: { id: presentationId },
        data: { status: PresentationStatus.READY, slideCount: files.length },
      });
    } catch (err) {
      await this.prisma.presentation.update({
        where: { id: presentationId },
        data: { status: PresentationStatus.FAILED },
      });
      throw err;
    } finally {
      await rm(workDir, { recursive: true, force: true });
    }
  }

  // La conversion tourne dans une promesse détachée en mémoire (voir upload()) :
  // un redémarrage du backend pendant un pdftoppm laisse la ligne bloquée en
  // CONVERTING pour toujours, et activate() la refusera à jamais (il exige
  // READY). Même filet de sécurité que pour les enregistrements bloqués
  // (EgressReconciliationService.reconcileStuckRecordings) : au-delà du seuil,
  // on marque FAILED pour que l'utilisateur voie l'échec et puisse réimporter,
  // au lieu d'un statut "en cours" mensonger et définitif.
  async failStuckConversions(): Promise<number> {
    const threshold = new Date(Date.now() - STUCK_CONVERSION_THRESHOLD_MS);
    const { count } = await this.prisma.presentation.updateMany({
      where: { status: PresentationStatus.CONVERTING, createdAt: { lt: threshold } },
      data: { status: PresentationStatus.FAILED },
    });
    if (count > 0) {
      this.logger.warn(`${count} conversion(s) de présentation bloquée(s) marquée(s) FAILED`);
    }
    return count;
  }

  // Les présentations importées sont propres à la session qui les a
  // uploadées (pas un espace de stockage permanent) — appelé par
  // RoomsService.close() pour nettoyer les diapositives S3 + les lignes DB
  // en même temps que la salle (et ses éventuels sous-groupes) se termine.
  async deleteAllForRoom(roomId: string): Promise<void> {
    const presentations = await this.prisma.presentation.findMany({
      where: { roomId },
      include: { slides: true },
    });
    if (presentations.length === 0) return;

    for (const presentation of presentations) {
      for (const slide of presentation.slides) {
        await this.s3.deleteObject(slide.s3Key).catch(() => {
          // Objet déjà absent ou MinIO temporairement indisponible : on ne
          // bloque pas la fermeture de la salle pour un fichier orphelin.
        });
      }
    }
    await this.prisma.presentation.deleteMany({ where: { roomId } });
  }

  async list(roomId: string): Promise<PresentationDto[]> {
    const presentations = await this.prisma.presentation.findMany({
      where: { roomId },
      include: { slides: true },
      orderBy: { createdAt: "desc" },
    });
    return presentations.map((p) => this.toDto(p));
  }

  async getOne(roomId: string, id: string): Promise<PresentationDto> {
    const presentation = await this.prisma.presentation.findUnique({
      where: { id },
      include: { slides: { orderBy: { index: "asc" } } },
    });
    if (!presentation || presentation.roomId !== roomId) throw new NotFoundException("Présentation introuvable");
    return this.toDto(presentation);
  }

  async getActive(roomId: string): Promise<PresentationDto | null> {
    const room = await this.prisma.room.findUnique({ where: { id: roomId } });
    if (!room?.currentPresentationId) return null;
    return this.getOne(roomId, room.currentPresentationId).catch(() => null);
  }

  async activate(roomId: string, presentationId: string): Promise<void> {
    const presentation = await this.prisma.presentation.findUnique({ where: { id: presentationId } });
    if (!presentation || presentation.roomId !== roomId) throw new NotFoundException("Présentation introuvable");
    if (presentation.status !== PresentationStatus.READY) {
      throw new BadRequestException("Cette présentation n'est pas encore prête");
    }
    await this.prisma.room.update({ where: { id: roomId }, data: { currentPresentationId: presentationId } });
  }

  async deactivate(roomId: string): Promise<void> {
    await this.prisma.room.update({ where: { id: roomId }, data: { currentPresentationId: null } });
  }

  async setCurrentSlide(roomId: string, presentationId: string, dto: SetCurrentSlideDto): Promise<void> {
    const presentation = await this.prisma.presentation.findUnique({ where: { id: presentationId } });
    if (!presentation || presentation.roomId !== roomId) throw new NotFoundException("Présentation introuvable");
    if (dto.slideIndex < 0 || dto.slideIndex >= presentation.slideCount) {
      throw new BadRequestException("Index de slide invalide");
    }
    await this.prisma.presentation.update({
      where: { id: presentationId },
      data: { currentSlideIndex: dto.slideIndex },
    });
  }

  private toDto(presentation: {
    id: string;
    roomId: string;
    filename: string;
    status: PresentationStatus;
    slideCount: number;
    currentSlideIndex: number;
    createdAt: Date;
    slides: { index: number; s3Key: string }[];
  }): PresentationDto {
    const secret = this.config.get<string>("secrets.downloadLink")!;
    const exp = Math.floor(Date.now() / 1000) + SLIDE_LINK_TTL_SECONDS;

    return {
      id: presentation.id,
      roomId: presentation.roomId,
      filename: presentation.filename,
      status: presentation.status,
      slideCount: presentation.slideCount,
      currentSlideIndex: presentation.currentSlideIndex,
      createdAt: presentation.createdAt.toISOString(),
      slides: presentation.slides
        .sort((a, b) => a.index - b.index)
        .map((s) => {
          const token = signDownloadToken({ resourceId: s.s3Key, exp }, secret);
          return { index: s.index, imageUrl: `/presentations/slides/image?token=${token}` };
        }),
    };
  }
}
