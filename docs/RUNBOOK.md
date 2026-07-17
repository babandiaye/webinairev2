# RUNBOOK — webinairev2

## Infra réutilisée (ne pas redéployer)

webinairev2 ne déploie **pas** son propre PostgreSQL/Redis/LiveKit : il réutilise la
stack existante de `/opt/livekit/compose.yaml` (déjà utilisée par livestreamv3) :

| Ressource | Où | Détail |
|---|---|---|
| PostgreSQL | conteneur `livekit_postgresql`, exposé `127.0.0.1:5432` | base dédiée `webinairev2` (créée le 2026-07-06), rôle `livekit` réutilisé |
| Redis | conteneur `livekit_redis`, exposé `127.0.0.1:6379` | db0 = LiveKit (existant), db1 = BullMQ (webinairev2) |
| LiveKit SFU/Egress/Ingress | conteneurs `livekit_sfu`/`livekit_egress`/`livekit_ingress` | même clé API que livestreamv3, SFU exposé `127.0.0.1:7880` + `preprod-webinairertc.unchk.sn` |
| MinIO | 10.149.2.209:9000 (externe) | bucket dédié `webinairev2` (créé le 2026-07-06) |

## Déploiement : natif (systemd + nginx), pas de Docker

Comme livestreamv3, webinairev2 tourne **sans conteneur** pour le backend/frontend :

- **Backend** (NestJS) : service systemd `webinairev2-backend.service`
  (`/etc/systemd/system/webinairev2-backend.service`, installé depuis
  `infra/systemd/webinairev2-backend.service`), `ExecStart=/usr/bin/pnpm start`
  (= `node dist/main.js`), `EnvironmentFile=/var/www/html/webinairev2/.env`,
  écoute sur `127.0.0.1:4010`. Logs : `/var/log/webinairev2_backend_{output,error}.log`.
- **Frontend** (React) : **aucun process** — build statique (`pnpm --filter
  @webinairev2/frontend build` → `apps/frontend/dist/`) servi directement par nginx.
- **nginx** : vhost `preprod-webinairev2.unchk.sn`
  (`/etc/nginx/sites-available/webinairev2.conf`, installé depuis
  `infra/nginx/webinairev2.conf`) : `root` sur `apps/frontend/dist`, `/api/` proxifié
  vers `127.0.0.1:4010/`, `/webhooks/` idem (pour le futur webhook LiveKit).
  DNS déjà en place (`preprod-webinairev2.unchk.sn` résout, même IP que les autres
  vhosts `*.unchk.sn`), certificat wildcard partagé réutilisé
  (`/etc/nginx/ssl/unchk.sn_cert.pem`).

Déployé et vérifié le 2026-07-06 : `curl https://preprod-webinairev2.unchk.sn/api/health`
→ `{"status":"ok",...}`, redirection HTTP→HTTPS OK, autres vhosts (`preprod-webinaire`,
`preprod-webinairertc`) non affectés par le reload nginx.

### Redéployer après un changement de code

```bash
cd /var/www/html/webinairev2
pnpm --filter @webinairev2/shared-types build
pnpm --filter @webinairev2/backend build
sudo systemctl restart webinairev2-backend.service

pnpm --filter @webinairev2/frontend build   # lit apps/frontend/.env (VITE_*)
# rien d'autre à faire : nginx sert directement apps/frontend/dist/
```

### Migrations Prisma

```bash
cd /var/www/html/webinairev2/apps/backend
DATABASE_URL="postgresql://livekit:<mdp>@127.0.0.1:5432/webinairev2" \
  pnpm exec prisma migrate deploy
```

## Authentification : flux OAuth côté serveur (client Keycloak partagé)

webinairev2 réutilise le client Keycloak **confidentiel** `unchk-monitor` (secret
fourni par l'utilisateur le 2026-07-06), plutôt qu'un client dédié. Un client
confidentiel ne doit jamais exposer son secret à un navigateur : l'échange
code→tokens se fait donc **entièrement côté backend** (`openid-client`,
`auth/oidc-client.service.ts` + `auth/auth.controller.ts`), pas en PKCE côté SPA.

- Session : cookie `webinairev2.sid` (HttpOnly, Secure, SameSite=Lax, 1h),
  stockée dans `livekit_redis` db2 via `connect-redis`/`express-session`
  (`main.ts`). Le frontend n'a plus aucune librairie OIDC (`oidc-client-ts`
  supprimée) — il redirige juste vers `/api/auth/login` et lit `/api/users/me`
  (`credentials: 'include'`) pour connaître l'état de connexion.
- Endpoints : `GET /auth/login` (redirige vers Keycloak), `GET /auth/callback`
  (échange le code, upsert l'utilisateur, pose le cookie, redirige vers le
  frontend), `GET /auth/logout` (détruit la session + logout RP-initiated
  Keycloak), `GET /auth/me`.
- Rôles applicatifs lus depuis les rôles de **realm** (`realm_access.roles` :
  `webinairev2-admin`/`webinairev2-moderator`), PAS les rôles du client
  `unchk-monitor` (qui appartiennent à cet autre projet) — voir
  `user-sync.service.ts`.

## Étapes manuelles restantes

1. **Redirect URI Keycloak** : ajouter `https://preprod-webinairev2.unchk.sn/api/auth/callback`
   aux "Valid Redirect URIs" du client `unchk-monitor` dans le realm `UNCHK`
   (`https://senid.unchk.sn/realms/UNCHK`) — sinon Keycloak refuse l'échange avec
   "Invalid redirect_uri". **C'est le seul blocage restant pour un login réel.**
2. **Rôles de realm** : créer les rôles `webinairev2-admin` / `webinairev2-moderator`
   au niveau du **realm** `UNCHK` (pas des rôles du client `unchk-monitor`) et les
   assigner aux comptes de test — sans ça tout le monde atterrit en VIEWER.
3. **Webhook LiveKit** (à faire seulement à partir du jalon 2, recordings) : ajouter
   `https://preprod-webinairev2.unchk.sn/api/webhooks/livekit` à `webhook.urls` dans
   `/opt/livekit/livekit-server.yaml` (même pattern que livestreamv3, qui utilise son
   URL publique plutôt qu'un accès direct au port local), puis
   `docker restart livekit_sfu`. Cette étape touche un fichier partagé avec
   livestreamv3 et redémarre un conteneur qui sert du trafic existant — à faire en
   confirmant avec l'utilisateur, pas automatiquement.

## Intégration Moodle (plugin `mod_webinairev2`, serveur-à-serveur)

Toutes les routes sous `/api/moodle/*` sont protégées par `MoodleApiKeyGuard`
(clé statique, pas de session Keycloak) : en-tête `X-Api-Key: <moodle.apiKey>`,
jamais appelé par le frontend SPA ni un navigateur. Le plugin PHP lui-même
(`classes/api.php`) vit dans un dépôt séparé, non présent dans ce repo.

| Route | Usage |
|---|---|
| `POST /moodle/rooms` | Crée (ou retrouve, idempotent sur `meetingId`) la salle liée à une activité Moodle |
| `GET /moodle/rooms/:roomId/status` | Statut courant de la salle |
| `GET /moodle/rooms/:roomId/recordings` | Liste des enregistrements prêts (lien de lecture signé, TTL 30 min) |
| `DELETE /moodle/rooms/:roomId/recordings/:recordingId` | Supprime un enregistrement |
| `POST /moodle/users/sync` | Synchronise le rôle applicatif d'un utilisateur depuis son rôle d'inscription au cours |

### `POST /moodle/users/sync`

Le plugin appelle cette route à chaque jonction de salle pour signaler qu'un
utilisateur a un rôle non-étudiant sur le cours (Enseignant, Enseignant non
éditeur, Gestionnaire...) — c'est le plugin qui décide de `isTeacher` d'après
le rôle d'inscription Moodle, jamais ce backend.

Requête :
```
POST /api/moodle/users/sync
X-Api-Key: <moodle.apiKey>
Content-Type: application/json

{
  "email": "enseignant1@unchk.edu.sn",
  "name": "Fatou Sow",
  "isTeacher": true
}
```

Réponse : `{ "userId": "...", "role": "MODERATOR" }`.

Règle appliquée (**promotion jamais rétrogradation**, `UsersService.ensureAtLeastModerator`) :
- Compte inexistant + `isTeacher=true` → créé directement en `MODERATOR`.
- Compte `VIEWER` existant + `isTeacher=true` → promu `MODERATOR`.
- Compte déjà `MODERATOR`/`ADMIN` → jamais touché, quel que soit `isTeacher`.
- `isTeacher=false` → upsert du compte (placeholder `VIEWER` si inexistant),
  **ne modifie jamais** un rôle déjà supérieur à VIEWER (un modérateur inscrit
  comme simple étudiant sur un autre cours ne doit pas être rétrogradé).

Cette même règle s'applique aussi à `POST /moodle/rooms` : l'enseignant qui crée
l'activité (`teacherEmail`) est désormais garanti d'être au moins `MODERATOR` en
sortie, plutôt que créé en `VIEWER` comme avant.

## Tester le template d'enregistrement (`lk egress test-template`)

Le CLI officiel LiveKit peut ouvrir directement la vue `/egress-view/:roomId`
dans un vrai navigateur (pas Chrome headless) avec des participants factices,
pour vérifier visuellement le rendu sans lancer un vrai enregistrement :

```bash
lk egress test-template \
  --base-url "https://preprod-webinairev2.unchk.sn/egress-view/<roomId>#token=<token>" \
  --publishers 4
```

La vue exige un token HMAC valide dans le fragment `#token=...` (voir
`EgressTokenGuard` — même mécanisme que les liens de téléchargement
d'enregistrement, scopé au `roomId` et expirant). Ce token n'est normalement
généré que côté serveur, au moment de `RecordingsService.start()` — pour un
test manuel, en génère un directement avec le même secret que le backend
(`DOWNLOAD_LINK_SECRET` dans `.env`) :

```bash
cd /var/www/html/webinairev2/apps/backend
DOWNLOAD_LINK_SECRET=$(grep ^DOWNLOAD_LINK_SECRET ../../.env | cut -d= -f2-) \
ROOM_ID=<roomId> \
EXP=$(($(date +%s) + 3600)) \
node -e '
const { createHmac } = require("crypto");
const payload = { resourceId: process.env.ROOM_ID, exp: Number(process.env.EXP) };
const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
const sig = createHmac("sha256", process.env.DOWNLOAD_LINK_SECRET).update(body).digest("base64url");
console.log(`${body}.${sig}`);
'
```

(Reproduit exactement `signDownloadToken()` de `common/download-token.util.ts` —
si cette fonction change un jour, mettre ce script à jour en même temps.)

Le `roomId` doit être celui d'une salle réelle existante (`Room.id` en base) ;
la vue interroge `whiteboard/state`/`presentations/active` via ce même token,
donc une salle inexistante donnera un écran vide sans erreur visible.

## Smoke tests par jalon

- **Jalon 1** (fait le 2026-07-06) :
  - `curl https://preprod-webinairev2.unchk.sn/api/rooms` sans en-tête → **401** (vérifié).
  - Token JWT altéré → **401** (vérifié, test négatif explicite C1).
  - Reste à faire : login SPA réel avec 2 comptes Keycloak
    (`webinairev2-moderator`, `webinairev2-viewer`) une fois le client Keycloak créé
    (étape manuelle ci-dessus) — création de salle, jonction vidéo bidirectionnelle.
- **Jalon 2** (à partir de l'ajout du module recordings) : déclencher un enregistrement,
  couper `livekit_egress` en cours pour vérifier la réconciliation ; vérifier qu'une
  clé S3 devinée sans signature échoue (403) et qu'un lien signé expire après TTL.
- **Jalon 3** : 3 breakout rooms, vérifier qu'un participant assigné ne peut pas
  rejoindre une autre breakout que la sienne (token scopé).
- **Jalon 4** : whiteboard synchronisé entre 2 navigateurs + réhydratation d'un
  3ᵉ participant tardif via `WhiteboardSnapshot`.
- **Jalon 5** : sondage créé/voté/résultats en direct entre 2 comptes.
- **Jalon 6** : upload PDF multi-pages, suivre `UPLOADED→CONVERTING→READY`, navigation
  de slide synchronisée.
