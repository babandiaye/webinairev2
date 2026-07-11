-- AlterTable
ALTER TABLE "rooms" ADD COLUMN     "assignedUserIds" TEXT[] DEFAULT ARRAY[]::TEXT[];
