# TODO — webinairev2

Liste vivante d'améliorations possibles, issue notamment d'une comparaison
avec livestreamv3 (2026-07-17). Pas un engagement de calendrier — à
prioriser au besoin.

## Fait

- [x] **2026-07-17** — Intégration Moodle : l'enseignant qui crée une activité
  (`POST /moodle/rooms`) est désormais garanti au moins `MODERATOR` en sortie
  (`UsersService.ensureAtLeastModerator`, règle "promotion jamais
  rétrogradation" — ne touche jamais un compte déjà `MODERATOR`/`ADMIN`).
- [x] **2026-07-17** — Nouvel endpoint `POST /moodle/users/sync` : le plugin
  Moodle peut signaler à la jonction qu'un utilisateur a un rôle non-étudiant
  sur le cours (Enseignant, Enseignant non éditeur, Gestionnaire...) ; promotion
  automatique en `MODERATOR` selon la même règle. Documenté dans
  `docs/RUNBOOK.md`. Le plugin PHP `mod_webinairev2` lui-même reste à écrire
  (dépôt séparé, sur le modèle de `mod_livestream`).
- [x] **2026-07-17** — Chrono d'enregistrement, façon Google Meet (démarrage →
  REC → finalisation), 6 changements :
  1. Correction du recalage de `Recording.startedAt` (`egress-reconciliation.service.ts`).
     Une première tentative plus tôt le même jour utilisait `egress.startedAt` ;
     vérifié dans le code source de `livekit/egress` (`pkg/config/pipeline.go`)
     que ce champ est posé une seule fois à la CRÉATION DU JOB, avant Chrome —
     il ne reflète jamais le vrai début de capture et ne corrigeait donc rien.
     Remplacé par l'heure de réception du webhook `EGRESS_ACTIVE`, qui se
     déclenche dans la même fonction Go que le vrai début de capture (±1-2 s de
     latence webhook).
  2. Push serveur des transitions de statut sur le data-channel
     `recording-control` (topic centralisé dans `@webinairev2/shared-types`) —
     le polling 5 s du frontend reste en filet de sécurité.
  3. `CallTopBar.tsx` : 3 états distincts (STARTING "va bientôt commencer…",
     ACTIVE = chrono, ENDING = chrono figé + "Finalisation…"), au lieu d'un
     affichage binaire.
  4. Réconciliation à la lecture (`RecordingsService.list()`) : un
     enregistrement bloqué en STARTING depuis >60 s ré-interroge LiveKit à la
     volée, sans attendre le cron de secours (5 min).
  5. **Non appliqué** : ajout d'un champ `durationSeconds` calculé par nos
     soins. Le champ `Recording.duration` existe déjà et est déjà alimenté par
     la valeur `FileInfo.Duration` calculée en interne par LiveKit lui-même à
     `EGRESS_COMPLETE` (basée sur son propre horodatage de capture exact, pas
     une approximation) — un nouveau champ aurait été redondant et moins
     précis. Rien changé sur ce point.
  6. Vues egress (`EgressRoomView.tsx`) migrées vers le SDK officiel
     `@livekit/egress-sdk` (`EgressHelper.setRoom`/`startRecording`) à la place
     du `console.log("START_RECORDING")` manuel — permet aussi une finalisation
     automatique (`END_RECORDING`) quand tous les autres participants ont
     quitté, en complément du garde-fou `room_finished` déjà existant côté
     webhook.

## À évaluer

- [ ] **Diffusion sortante RTMP/WHIP (OBS, restream)** — présente et
  fonctionnelle sur livestreamv3 (ingress + `start-streaming`/`stop-streaming`),
  absente ici (`apps/backend/src/ingress/` existe mais est un dossier vide).
  À confirmer si ce besoin existe réellement pour webinairev2 (webinaires vs
  diffusion externe) avant de l'implémenter.
- [ ] **Notion d'inscription par salle (Enrollment)** — sur livestreamv3, un
  viewer doit être explicitement inscrit à une session pour la rejoindre.
  webinairev2 contrôle l'accès par rôle global + présence d'un modérateur en
  direct, sans liste d'inscrits par salle. À évaluer si un contrôle plus fin
  est nécessaire (ex. cours réservés à une promotion).
- [ ] **"Inviter sur scène" explicite** — livestreamv3 a un workflow dédié
  (`invite_to_stage`/`remove_from_stage`) pour promouvoir ponctuellement un
  spectateur pendant un live. webinairev2 gère une permission de parler/caméra
  accordée par salle (mécanisme voisin, pas strictement équivalent) — à
  comparer avec un vrai besoin utilisateur avant d'ajouter quoi que ce soit.
- [ ] **Tests automatisés** — aucun test (`*.spec.ts`) sur backend ni
  frontend, comme sur livestreamv3. Pas bloquant à ce stade mais à garder en
  tête si le projet grossit encore.
- [ ] **Jalons 3-6 (breakout/whiteboard/sondages/présentations)** — codés et
  déployés mais jamais testés en conditions réelles avec plusieurs comptes
  simultanés (voir `docs/RUNBOOK.md`, section smoke tests).
