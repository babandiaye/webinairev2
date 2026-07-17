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
- [x] **2026-07-17** — Chrono d'enregistrement (`CallTopBar.tsx`) qui démarrait
  déjà à ~00:10 : `Recording.startedAt` est maintenant recalé sur l'horodatage
  réel de LiveKit (`egress.startedAt`) à la transition STARTING→ACTIVE, au lieu
  de rester figé sur l'instant de la demande.

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
