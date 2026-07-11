ALTER TABLE "rooms" ADD COLUMN "moodleCourseId" TEXT;
ALTER TABLE "rooms" ADD COLUMN "moodleMeetingId" TEXT;
CREATE UNIQUE INDEX "rooms_moodleMeetingId_key" ON "rooms"("moodleMeetingId");
