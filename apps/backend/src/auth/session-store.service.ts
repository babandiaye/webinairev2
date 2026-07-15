import { Injectable, OnModuleDestroy } from "@nestjs/common";
import Redis from "ioredis";

// Même préfixe que RedisStore dans main.ts (connect-redis) — clé d'accès directe
// aux sessions HTTP stockées dans Redis, en dehors du cycle request/response.
const SESSION_KEY_PREFIX = "webinairev2:sess:";

// La session (express-session + connect-redis) est une snapshot de l'utilisateur
// prise au login — désactiver/supprimer un compte en base ne change rien pour
// quelqu'un déjà connecté tant que sa session n'expire pas (jusqu'à 12h, glissant
// tant qu'il est actif, voir main.ts). Ce service la révoque immédiatement, sans
// quoi "désactiver" un compte resterait sans effet réel pour un utilisateur en
// pleine session.
@Injectable()
export class SessionStoreService implements OnModuleDestroy {
  private readonly redis = new Redis(process.env.SESSION_REDIS_URL!);

  async onModuleDestroy() {
    this.redis.disconnect();
  }

  async revokeUserSessions(userId: string): Promise<void> {
    const toDelete: string[] = [];
    const stream = this.redis.scanStream({ match: `${SESSION_KEY_PREFIX}*`, count: 100 });

    for await (const keys of stream as AsyncIterable<string[]>) {
      for (const key of keys) {
        const raw = await this.redis.get(key);
        if (!raw) continue;
        try {
          const session = JSON.parse(raw);
          if (session?.user?.id === userId) toDelete.push(key);
        } catch {
          // session malformée : ignorée, pas notre affaire ici
        }
      }
    }

    if (toDelete.length > 0) await this.redis.del(...toDelete);
  }
}
