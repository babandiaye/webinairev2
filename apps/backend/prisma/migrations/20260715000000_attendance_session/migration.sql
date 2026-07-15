ALTER TABLE "attendance_records" ADD COLUMN "sessionStartedAt" TIMESTAMP(3);

-- Backfill : rattache chaque ligne existante au startedAt courant de sa salle
-- (seule frontière de session connue à date de cette migration). Les salles qui
-- n'ont eu qu'une seule session sont taguées correctement. Les salles déjà
-- contaminées par plusieurs sessions mélangées restent groupées jusqu'à leur
-- prochain redémarrage, à partir duquel la séparation par session s'applique.
UPDATE "attendance_records" ar
SET "sessionStartedAt" = COALESCE(r."startedAt", ar."joinedAt")
FROM "rooms" r
WHERE ar."roomId" = r."id" AND ar."sessionStartedAt" IS NULL;

ALTER TABLE "attendance_records" ALTER COLUMN "sessionStartedAt" SET NOT NULL;

CREATE INDEX "attendance_records_roomId_sessionStartedAt_idx" ON "attendance_records"("roomId", "sessionStartedAt");
