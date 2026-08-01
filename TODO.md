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

- [x] **2026-07-19 → 2026-07-31** — Rôles et inscriptions par salle
  (`Enrollment`), co-modération, restrictions des salles Moodle, verrouillage
  micro/caméra configurable par salle, réglages « Session » réservés à
  l'animateur, corrections d'audit de bout en bout. Rend caduque l'ancienne
  entrée « à évaluer » sur la notion d'inscription : c'est fait.
- [x] **2026-07-31** — Bruit et écho entre appareils proches : bouton
  « Haut-parleurs » (coupe la sortie de CET appareil, persisté par appareil),
  détection heuristique d'écho en séance (`useEchoDetection`) et bannière de
  suggestion. Rappel du constat qui motive tout le dispositif : l'annulation
  d'écho du navigateur ne peut annuler QUE le retour de son propre haut-parleur,
  jamais celui d'un appareil voisin — couper la sortie est le seul vrai remède.
- [x] **2026-08-01** — Fiabilité des enregistrements :
  - Plafond de captures simultanées (`MAX_CONCURRENT_RECORDINGS`, défaut 3).
    La contrainte précédente était par salle et ne protégeait rien à l'échelle
    du nœud : chaque enregistrement est un Chrome headless complet, et au-delà
    de la capacité LiveKit accepte le job puis dégrade les captures déjà en
    cours. Autorité = `listEgress({active})`, repli sur la base si l'Egress est
    injoignable.
  - Composant « Stockage enregistrements » sur la page Statut (`checkMinio()`
    ne testait que la joignabilité, donc restait vert avec un volume plein).
  - Purge de rétention nocturne (`RecordingsService.purgeExpired`).
- [x] **2026-08-01** — Écran de pré-connexion (`PreJoinScreen`) : périphériques
  mémorisés, aperçu caméra, vumètre, test d'écho façon BBB et test de tonalité
  pour les participants au micro verrouillé. **Non testé en conditions réelles**
  (demande un navigateur avec plusieurs périphériques audio).

## Feuille de route (révisée le 2026-08-01)

Issue d'une comparaison de bout en bout avec **BigBlueButton**, **La Suite Meet**
(LiveKit + Django, déployée à l'administration française) et **livestreamv3**.
Le socle fonctionnel est déjà large ; ce qui manque face à BBB n'est pas le
nombre de fonctionnalités mais **la profondeur pédagogique de chacune** et **la
persistance des traces**.

### Décisions prises

- **Quota de stockage et rétention désactivés** (`RECORDINGS_QUOTA_GB=0`,
  `RECORDINGS_RETENTION_DAYS=0`). Les deux mécanismes restent dans le code,
  inertes ; une valeur > 0 les réactive sans changement de code. Conséquence
  assumée : rien n'alerte ni ne freine la saturation du volume.
- **Chat persisté en base : écarté pour l'instant.** Le chat reste donc
  volatile (canal de données LiveKit) : pas d'historique pour un retardataire,
  rien de récupérable après le cours, pas de suppression par le modérateur.

### Vague 1 — en cours

- [x] Plafond de captures simultanées + supervision du stockage.
- [x] Rétention (mécanisme en place, désactivé).
- [x] Écran de pré-connexion avec test d'écho.
- [ ] ~~Chat persisté en base~~ — écarté (voir ci-dessus).
- [x] **Réactions et file de mains levées ordonnée** — message `sync` à l'entrée
  (un animateur qui rafraîchissait sa page trouvait la file vide), ordre transmis
  en durée écoulée et non en horodatage absolu (deux horloges divergentes
  suffisaient à inverser la file), rang cliquable et « Tout baisser ».
- [x] **Verrous d'interaction** — discussion, réactions, liste des participants.
  Trois et non les huit de BBB : « voir les caméras des autres » existait déjà de
  fait (`CallStage` ne montre la bande secondaire qu'à `canManage`), « se démuter
  soi-même » fait doublon avec `micLocked`, et « chat privé »/« notes partagées »
  portent sur des fonctionnalités absentes. Ces trois-là ne correspondent à
  AUCUNE permission LiveKit (le SFU ne filtre pas un canal de données par sujet) :
  ils sont appliqués par les clients des deux côtés — contrôle masqué chez
  l'émetteur, réception filtrée chez chaque destinataire. Ce n'est pas la
  garantie d'un filtrage serveur et ne doit pas être présenté comme tel.
  Propagation par les métadonnées de salle LiveKit.
- [x] **Inscription en masse par CSV** — parseur extrait en
  `common/csv-rows.util.ts` et partagé avec l'import d'utilisateurs (un
  enseignant n'a pas à connaître deux formats). Les comptes inconnus sont créés
  en `pending:`, sans quoi un cours ne pourrait pas être préparé avant la
  première connexion des étudiants ; la colonne `role` est délibérément ignorée,
  cette route étant ouverte aux enseignants.
- [x] **Tableau de bord d'engagement (live, sans stockage)** — livré le
  2026-08-01, avec export CSV et PDF. Ce que LiveKit
  fournit réellement, vérifié dans `@livekit/protocol` 1.49 :
  - *Temps de présence* et *nombre de connexions* : ✅ déjà couverts par les
    webhooks `participant_joined`/`participant_left` et le modèle
    `AttendanceRecord`.
  - *Activation micro/caméra* : ✅ webhooks `track_published`/`track_unpublished`.
  - *Temps de parole* : ⚠️ **aucun webhook LiveKit ne l'expose**. La liste
    complète des événements est `room_started`, `room_finished`,
    `participant_joined`, `participant_left`, `participant_connection_aborted`,
    `track_published`, `track_unpublished`, `egress_*`, `ingress_*`. Le SFU
    calcule bien les orateurs actifs mais ne les diffuse qu'aux **clients**
    connectés (`ActiveSpeakersChanged`) : l'agrégation ne peut se faire que dans
    le navigateur. Les messages `Analytics*` présents dans le protocole
    appartiennent au service interne de LiveKit Cloud — aucune clé `analytics:`
    n'existe dans notre `livekit-server.yaml` auto-hébergé.
  - *Réactions / messages de chat* : ❌ rien côté LiveKit — le chat est un canal
    de données opaque au SFU comme au backend.
  → Conclusion : un tableau **de séance** (calculé dans le navigateur de
  l'animateur, perdu à la fermeture) est faisable sans une seule écriture en
  base — c'est d'ailleurs exactement ce qu'est le *Learning Analytics Dashboard*
  de BBB. Conserver ces chiffres après le cours supposerait une écriture
  d'agrégats en fin de séance : **décision à prendre**.

### Vague 2 — le cœur pédagogique

- [ ] **Annotation sur diapositive + tableau blanc multi-utilisateur** — le
  point le plus structurant de toute la liste. Aujourd'hui présentation
  (`PresentationsPanel`) et tableau blanc (`Whiteboard`, Excalidraw) sont deux
  panneaux séparés ; chez BBB le tableau blanc EST la couche d'annotation posée
  sur la diapositive, avec le curseur du présentateur visible. Les deux briques
  existent, il s'agit de les superposer et de lier les annotations à `slideId`.
- [ ] **Mises en page sélectionnables + épinglage** — `CallStage` est câblé en
  dur (une vidéo principale + une bande secondaire). BBB 3.0 en propose cinq ;
  « présentation seule » serait le défaut souhaitable pour un cours à 60
  étudiants caméras coupées.
- [ ] **Notes partagées collaboratives** — absentes.
- [ ] **Minuteur de séance** ; **durée et retour automatique** sur les
  sous-groupes (aucune notion de durée aujourd'hui dans `breakout-rooms`).
- [ ] **Quiz noté** — extension des sondages existants (bonne réponse,
  correction, export des résultats).

### Vague 3 — différenciation

- [ ] **Sous-titres et transcription automatique**, puis résumé de séance.
  Meet le propose (bêta) ; expérience Ollama/Claude déjà acquise sur MoodleScout.
- [ ] **Diffusion RTMP sortante + page publique de visionnage** — déjà écrit
  dans livestreamv3 (`start-streaming`/`stop-streaming`, `/watch/[roomName]`).
  Pour un cours magistral à large audience, diffuser coûte infiniment moins cher
  en SFU que N connexions WebRTC.
- [ ] **Ingress RTMP/WHIP** (OBS, caméra d'amphi) — `apps/backend/src/ingress/`
  existe mais est un **dossier vide**, non déclaré dans `app.module.ts` :
  vestige à nettoyer ou à remplir.
- [ ] **Lecture d'enregistrement enrichie** (chapitres, diapositives et chat
  rejoués) plutôt qu'un MP4 composite unique.
- [ ] **Arrière-plan flouté**, **partage de vidéo externe synchronisé**,
  **salle d'attente / invités**.

### Fiabilité des enregistrements — points ouverts (hors code)

Relèvent de l'infrastructure `/opt/livekit`, pas de l'applicatif :

- [ ] **Aucune sauvegarde du bucket** : MinIO est sur un hôte distant
  (`S3_ENDPOINT`), bucket unique, pas de réplication. Sa perte = perte de tous
  les enregistrements, souvent l'unique trace d'un cours.
- [ ] **Aucune segmentation** : un egress qui tombe à 1 h 30 d'un cours de 2 h ne
  laisse rien. LiveKit sait produire des segments (HLS) en complément du fichier.
- [ ] **Coupure silencieuse à 3 h** : `session_limits.file_output_max_duration`
  dans `egress.yaml` tronque un cours plus long sans le signaler à personne.
- [ ] **Aucune notification d'échec** : un `FAILED` est écrit en base et loggé
  en `warn`, mais l'enseignant croit son cours enregistré.

### À évaluer

- [ ] **« Inviter sur scène » explicite** — livestreamv3 a un workflow dédié
  (`invite_to_stage`/`remove_from_stage`). webinairev2 gère une permission de
  parler/caméra accordée par salle (mécanisme voisin, pas strictement
  équivalent) — à comparer avec un vrai besoin utilisateur.
- [ ] **Réglages applicatifs à chaud** — livestreamv3 a un modèle `AppSetting`
  clé/valeur + page admin ; ici tout est en `.env`, donc redémarrage obligatoire.
- [ ] **Tests automatisés** — aucun test (`*.spec.ts`) sur backend ni frontend.
  Pas bloquant à ce stade mais à garder en tête si le projet grossit encore.
- [ ] **Jalons 3-6 (breakout/whiteboard/sondages/présentations)** — codés et
  déployés mais jamais testés en conditions réelles avec plusieurs comptes
  simultanés (voir `docs/RUNBOOK.md`, section smoke tests). S'y ajoute
  désormais l'écran de pré-connexion.
