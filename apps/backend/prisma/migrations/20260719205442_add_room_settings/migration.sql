-- AlterTable
ALTER TABLE "rooms" ADD COLUMN     "cameraLocked" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "micLocked" BOOLEAN NOT NULL DEFAULT true;
