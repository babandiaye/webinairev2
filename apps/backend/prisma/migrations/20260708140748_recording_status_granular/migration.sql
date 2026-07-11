-- AlterEnum
BEGIN;
CREATE TYPE "RecordingStatus_new" AS ENUM ('STARTING', 'ACTIVE', 'ENDING', 'READY', 'FAILED');
ALTER TABLE "recordings" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "recordings" ALTER COLUMN "status" TYPE "RecordingStatus_new" USING ("status"::text::"RecordingStatus_new");
ALTER TYPE "RecordingStatus" RENAME TO "RecordingStatus_old";
ALTER TYPE "RecordingStatus_new" RENAME TO "RecordingStatus";
DROP TYPE "RecordingStatus_old";
ALTER TABLE "recordings" ALTER COLUMN "status" SET DEFAULT 'STARTING';
COMMIT;
