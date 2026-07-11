CREATE TABLE "attendance_records" (
    "id" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "identity" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isModerator" BOOLEAN NOT NULL DEFAULT false,
    "joinedAt" TIMESTAMP(3) NOT NULL,
    "leftAt" TIMESTAMP(3),

    CONSTRAINT "attendance_records_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "attendance_records_roomId_idx" ON "attendance_records"("roomId");
CREATE INDEX "attendance_records_roomId_identity_idx" ON "attendance_records"("roomId", "identity");

ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_roomId_fkey"
  FOREIGN KEY ("roomId") REFERENCES "rooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;
