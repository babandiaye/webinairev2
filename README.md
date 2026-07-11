# webinairev2

Alternative à BigBlueButton bâtie sur [LiveKit](https://livekit.io) : visioconférence
(modérateur / participants), breakout rooms, tableau blanc collaboratif, sondages,
partage de présentations, permissions façon BBB (parole/présentation accordées par
le modérateur), enregistrement et suivi de présence. Backend NestJS, frontend
React/Vite, monorepo pnpm.

Ce déploiement de référence est **natif** (systemd + nginx), sans conteneur pour
l'application elle-même — seule l'infrastructure (PostgreSQL, Redis, LiveKit,
S3/MinIO) peut être conteneurisée ou non, au choix.

## Architecture

```
apps/backend            NestJS — API, auth, orchestration LiveKit, webhooks
apps/frontend            React + Vite — SPA statique
packages/shared-types    DTOs/enums partagés backend ↔ frontend
infra/nginx              Vhost nginx de référence (frontend statique + proxy /api)
infra/systemd            Unit systemd de référence pour le backend
docs/RUNBOOK.md          Détail du déploiement UNCHK (infra réutilisée, jalons de test)
```

## Prérequis

- **Node.js 20** (LTS)
- **pnpm 9** (`corepack enable`, le monorepo est pin sur `pnpm@9.15.0`)
- **PostgreSQL** ≥ 14
- **Redis** ≥ 6 (utilisé pour BullMQ — jobs de conversion de présentations — et pour
  les sessions HTTP ; une seule instance suffit, deux index de base différents)
- **Stockage compatible S3** (MinIO ou AWS S3) avec un bucket dédié
- **Serveur LiveKit** (SFU) avec **Egress** activé (nécessaire pour les
  enregistrements et les vues Web-Egress tableau blanc/présentation).
  L'Ingress LiveKit est instancié côté backend mais n'est utilisé par aucune
  fonctionnalité actuelle — non requis.
- **Fournisseur OIDC** (Keycloak ou équivalent) avec un client **confidentiel**
  (pas un client public/SPA) : l'échange de code OAuth se fait entièrement côté
  backend NestJS, jamais dans le navigateur.
- **nginx** (ou tout reverse proxy capable de terminer TLS et de faire passer les
  WebSocket) pour servir le build statique du frontend et proxifier `/api`
- Un **nom de domaine avec certificat TLS** — WebRTC (`getUserMedia`) exige HTTPS
- Fortement recommandé : un **serveur TURN** (coturn ou équivalent) en repli — voir
  [Dépannage](#dépannage--vidéo-noire--pas-de-flux-audio-vidéo)

## Déploiement de bout en bout

### 1. Cloner et installer les dépendances

```bash
git clone git@github.com:babandiaye/webinairev2.git
cd webinairev2
corepack enable            # ou : npm i -g pnpm@9.15.0
pnpm install
```

### 2. Préparer l'infrastructure

**PostgreSQL** — créer un rôle et une base dédiés :

```sql
CREATE USER webinairev2 WITH PASSWORD 'un-mot-de-passe-fort';
CREATE DATABASE webinairev2 OWNER webinairev2;
```

**Redis** — aucune configuration particulière, juste noter l'URL et choisir deux
index de base distincts (ex. `/1` pour BullMQ, `/2` pour les sessions) si
l'instance est partagée avec d'autres usages.

**MinIO / S3** — créer un bucket dédié (ex. `webinairev2`) et une paire
access key/secret avec droits lecture/écriture dessus.

**LiveKit (SFU + Egress)** — déployer un serveur LiveKit (voir la
[documentation officielle](https://docs.livekit.io/home/self-hosting/deployment/))
avec le service Egress activé. Récupérer la clé/secret API (bloc `keys:` du
`livekit-server.yaml`) et l'URL WebSocket publique.

> **Retour d'expérience — TURN indispensable en réseau restrictif.** Sans serveur
> TURN de repli déclaré dans `rtc.turn_servers`, LiveKit n'annonce que l'IP
> publique directe. Un client derrière un pare-feu bloquant l'UDP sortant (proxy
> d'entreprise, certains réseaux campus, 4G restrictive) reste "connecté" au
> niveau de la signalisation (chat, liste des participants) mais ne recevra
> **jamais** de flux audio/vidéo — symptôme observé : écran noir permanent ou
> intermittent côté participant. Configurer un TURN over TLS:443 (passe la
> plupart des pare-feux car indiscernable de HTTPS classique) avant toute mise
> en production :
>
> ```yaml
> rtc:
>   turn_servers:
>     - host: turn.exemple.org
>       port: 443
>       protocol: tls
>       username: livekit
>       credential: <secret>
> ```

**Fournisseur OIDC (Keycloak)** :
1. Créer un client **confidentiel** (`Access Type: confidential`, pas `public`).
2. Ajouter `https://<votre-domaine>/api/auth/callback` aux *Valid Redirect URIs*.
3. Créer deux rôles de **realm** (pas des rôles de client) : `webinairev2-admin`
   et `webinairev2-moderator`, et les assigner aux comptes voulus — un
   utilisateur sans ces rôles entre en simple participant (`VIEWER`) par défaut.

### 3. Configurer les variables d'environnement

```bash
cp .env.example .env
```

Renseigner chaque valeur dans `.env` (voir les commentaires du fichier pour le
détail) — variables requises, validées au démarrage (`env.validation.ts`, échec
immédiat si une valeur manque) :

| Variable | Rôle |
|---|---|
| `DATABASE_URL` | Connexion PostgreSQL |
| `BULLMQ_REDIS_URL` / `SESSION_REDIS_URL` | Redis — jobs présentations / sessions HTTP |
| `S3_ENDPOINT`, `S3_ACCESS_KEY`, `S3_SECRET`, `S3_REGION`, `S3_BUCKET` | Stockage enregistrements/slides |
| `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` | Auth vers le serveur LiveKit |
| `LIVEKIT_WS_URL` | URL interne (ex. `ws://127.0.0.1:7880`), utilisée par le backend pour parler au SFU |
| `LIVEKIT_WS_URL_PUBLIC` | URL publique (ex. `wss://rtc.exemple.org`), la seule renvoyée au navigateur |
| `KEYCLOAK_ISSUER`, `KEYCLOAK_CLIENT_ID`, `KEYCLOAK_CLIENT_SECRET` | OIDC — client confidentiel |
| `PUBLIC_URL`, `FRONTEND_URL` | URL publique de l'appli (redirect URI OAuth = `PUBLIC_URL + /api/auth/callback`) |
| `SESSION_SECRET` | Signature du cookie de session (≥ 16 caractères) |
| `WEBHOOK_HMAC_SECRET` | Vérification de signature des webhooks LiveKit |
| `DOWNLOAD_LINK_SECRET` | Signature des liens de téléchargement d'enregistrements (jamais d'URL S3 directe) |
| `MOODLE_API_KEY` | Clé partagée avec le plugin Moodle (auth `X-Api-Key`, voir plus bas) |
| `BACKEND_PORT` | Port d'écoute du backend (défaut `3000`) |

Le frontend a son propre fichier, lu **au build** par Vite (`VITE_*` uniquement) :

```bash
cat > apps/frontend/.env <<'EOF'
VITE_API_URL=https://<votre-domaine>/api
VITE_LIVEKIT_WS_URL=wss://<url-publique-livekit>
EOF
```

### 4. Base de données — client Prisma et migrations

```bash
cd apps/backend
pnpm exec prisma generate
DATABASE_URL="postgresql://webinairev2:...@host:5432/webinairev2" pnpm exec prisma migrate deploy
cd ../..
```

### 5. Builder l'application

```bash
pnpm build   # shared-types → backend → frontend, dans cet ordre (package.json racine)
```

### 6. Lancer le backend

Avec systemd (recommandé) — adapter chemins/utilisateur dans
`infra/systemd/webinairev2-backend.service` avant copie :

```bash
sudo cp infra/systemd/webinairev2-backend.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now webinairev2-backend.service
```

Ou manuellement (utile en dev) :

```bash
pnpm start   # = node apps/backend/dist/main.js, écoute sur BACKEND_PORT
```

### 7. Servir le frontend et exposer l'API (nginx)

Adapter `server_name`, chemins de certificats TLS et `root` dans
`infra/nginx/webinairev2.conf`, puis :

```bash
sudo cp infra/nginx/webinairev2.conf /etc/nginx/sites-available/webinairev2.conf
sudo ln -s /etc/nginx/sites-available/webinairev2.conf /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

### 8. Configurer le webhook LiveKit

Ajouter dans le `livekit-server.yaml` du serveur LiveKit :

```yaml
webhook:
  api_key: <clé API LiveKit>
  urls:
    - https://<votre-domaine>/api/webhooks/livekit
```

puis redémarrer LiveKit. Ce webhook alimente le suivi de présence
(`participant_joined`/`participant_left`) et la réconciliation des enregistrements
(`egress_started`/`egress_ended`).

### 9. Vérification

```bash
curl https://<votre-domaine>/api/health
# {"status":"ok",...}

curl https://<votre-domaine>/api/rooms
# 401 attendu sans session
```

Puis manuellement : se connecter via `/api/auth/login` (redirection Keycloak et
retour), créer une salle, la rejoindre avec deux comptes (un modérateur, un
participant), vérifier micro/caméra/partage d'écran dans les deux sens.

## Redéployer après une mise à jour du code

```bash
git pull
pnpm install                      # si les dépendances ont changé
pnpm --filter @webinairev2/shared-types build
pnpm --filter @webinairev2/backend build
cd apps/backend && pnpm exec prisma migrate deploy && cd ../..   # si nouvelle(s) migration(s)
sudo systemctl restart webinairev2-backend.service

pnpm --filter @webinairev2/frontend build   # lit apps/frontend/.env (VITE_*)
# rien d'autre : nginx sert directement apps/frontend/dist/
```

## Intégration Moodle (optionnel)

Un plugin Moodle (`mod_webinairev2`) permet de créer/lancer des sessions depuis un
cours Moodle via l'API `X-Api-Key` (`MOODLE_API_KEY`). Le lien de jonction pointe
vers cette application (SSO Keycloak partagé) — Moodle n'émet jamais de jeton
LiveKit brut. Voir le dépôt du plugin pour l'installation côté Moodle.

## Dépannage : vidéo noire / pas de flux audio-vidéo

Si la session se connecte (chat, liste des participants, changements de
permission fonctionnent) mais que l'écran vidéo reste noir en continu ou par
intermittence :

1. Ouvrir `chrome://webrtc-internals` **avant** de rejoindre la salle, reproduire,
   puis vérifier l'état de la connexion active : `iceConnectionState`/`dtlsState`
   doivent passer à `connected`, et une paire de candidats ICE doit apparaître
   comme `succeeded`.
2. Si aucune paire ne réussit (ou seulement via `relay`) : le réseau du client
   bloque probablement l'UDP direct — un serveur TURN correctement configuré
   (voir [Prérequis](#prérequis)) est nécessaire.
3. Si la connexion est `connected` mais l'écran reste noir : vérifier côté
   serveur qu'une piste vidéo saine est bien publiée (`RoomServiceClient.listParticipants`,
   champ `muted`/`width`/`height` de chaque piste) avant de suspecter un bug de
   rendu frontend.

## Documentation complémentaire

`docs/RUNBOOK.md` détaille l'infrastructure réutilisée et les jalons de test pour
le déploiement de référence (UNCHK) — utile pour comprendre les choix
d'implémentation, pas nécessaire pour un déploiement neuf.
