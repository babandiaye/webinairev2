import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { ValidationPipe } from "@nestjs/common";
import { NestExpressApplication } from "@nestjs/platform-express";
import session from "express-session";
import RedisStore from "connect-redis";
import Redis from "ioredis";
import { AppModule } from "./app.module";

async function bootstrap() {
  // rawBody: true est indispensable pour /webhooks/livekit — WebhookReceiver.receive()
  // vérifie la signature HMAC sur le corps brut exact, que le body-parser JSON par
  // défaut re-sérialiserait et casserait silencieusement.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    rawBody: true,
  });

  // LiveKit poste ses webhooks avec Content-Type: application/webhook+json (pas
  // application/json) précisément pour éviter qu'un middleware JSON générique ne
  // consomme le corps avant la vérification de signature — mais ça veut dire que
  // le body-parser JSON par défaut de Nest (qui ne matche que application/json)
  // ignore silencieusement ces requêtes et req.rawBody reste vide. On enregistre
  // un second parser JSON qui matche aussi ce content-type spécifique.
  // limit explicite : le défaut d'Express est 100 Ko, ce qui suffisait pour tout
  // SAUF l'instantané du tableau blanc — une scène Excalidraw pèse ~2,75 Ko par
  // trait à main levée, donc franchissait ce plafond au bout d'environ 35 traits
  // (deux à trois minutes d'écriture). Passé ce seuil, PUT /rooms/:id/whiteboard
  // répondait 413 et l'instantané serveur restait figé pour le reste de la
  // séance : tout participant rejoignant ensuite recevait un tableau incomplet,
  // sans que rien ne le signale (l'appel était avalé par un .catch vide côté
  // client, corrigé en même temps). Constaté en production le 2026-08-01 :
  // dernier enregistrement réussi à 98,6 Ko, tous les suivants en 413.
  // 10 Mo couvre largement un cours entier (~3600 traits) ; nginx plafonne de
  // toute façon /api/ à 50 Mo en amont, et toutes ces routes sont authentifiées.
  app.useBodyParser("json", {
    type: ["application/json", "application/webhook+json"],
    limit: "10mb",
  });

  // Nécessaire derrière le reverse-proxy nginx pour que `secure: true` sur le
  // cookie de session et la détection HTTPS fonctionnent correctement.
  app.set("trust proxy", 1);

  const frontendUrl = process.env.FRONTEND_URL!;

  // origin explicite (pas `true`/reflect-any-origin) car les requêtes portent
  // désormais un cookie de session — élargir l'origine autorisée romprait
  // l'isolation que le cookie est censé fournir.
  app.enableCors({ origin: frontendUrl, credentials: true });

  const sessionRedis = new Redis(process.env.SESSION_REDIS_URL!);
  app.use(
    session({
      store: new RedisStore({ client: sessionRedis, prefix: "webinairev2:sess:" }),
      name: "webinairev2.sid",
      secret: process.env.SESSION_SECRET!,
      resave: false,
      saveUninitialized: false,
      // rolling: la session glisse à chaque requête tant que l'utilisateur est
      // actif — sans ça, maxAge est fixé une fois pour toutes au login et expire
      // même en pleine réunion (constaté : token LiveKit valide 10h mais session
      // coupée après 1h, provoquant des 401 sur l'API en pleine réunion active).
      rolling: true,
      cookie: {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        maxAge: 12 * 60 * 60 * 1000,
      },
    })
  );

  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));

  const port = process.env.BACKEND_PORT ?? 3000;
  await app.listen(port);
}

bootstrap();
