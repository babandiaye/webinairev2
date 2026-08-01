-- Plusieurs plateformes Moodle sur un même backend webinairev2.
--
-- 1. Retrait de l'unicité sur "moodleMeetingId". Ce champ est l'id de la ligne
--    `webinairev2` côté Moodle : il n'est unique qu'au sein d'UNE plateforme.
--    L'activité n°1 de disi-dev et l'activité n°1 d'un autre Moodle portent le
--    même identifiant ; la contrainte les forçait à partager une seule Room, et
--    MoodleService s'en servait comme clé de réutilisation. livestreamv3 a subi
--    exactement cet incident le 27/07/2026 (« TEST Integration DISIDEV »
--    rattachée à « Introduction au droit »). Le champ reste enregistré comme
--    métadonnée de provenance ; l'idempotence est désormais garantie côté
--    plugin, qui n'appelle createRoom qu'à la création de l'activité.
--    Un index simple le remplace : les lectures par provenance restent utiles
--    au diagnostic, seule l'unicité était fautive.
DROP INDEX IF EXISTS "rooms_moodleMeetingId_key";
CREATE INDEX IF NOT EXISTS "rooms_moodleMeetingId_idx" ON "rooms"("moodleMeetingId");

-- 2. URL de retour vers la page d'activité Moodle d'origine, transmise
--    serveur-à-serveur par le plugin. Chaque salle porte celle de SA plateforme :
--    le retour en fin de séance fonctionne pour N Moodle sans liste blanche à
--    configurer côté frontend, et la valeur ne transite jamais par la barre
--    d'adresse (pas de redirection ouverte possible).
ALTER TABLE "rooms" ADD COLUMN IF NOT EXISTS "moodleReturnUrl" TEXT;
