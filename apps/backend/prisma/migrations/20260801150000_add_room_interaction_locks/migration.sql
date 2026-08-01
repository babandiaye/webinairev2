-- AlterTable
-- Verrous d'interaction, par défaut FALSE (rien de verrouillé) : contrairement à
-- micLocked/cameraLocked, ces restrictions ne sont pas le comportement normal
-- d'un cours mais des mesures ponctuelles (examen, recadrage d'un chat qui
-- déborde) que l'animateur active quand il en a besoin.
ALTER TABLE "rooms" ADD COLUMN     "chatLocked" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "reactionsLocked" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "participantListLocked" BOOLEAN NOT NULL DEFAULT false;
