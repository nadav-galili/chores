import { sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { requireClerkUser, type VerifyToken } from './auth.ts';
import type { Db } from './db/client.ts';
import { choreRoutes } from './chores.ts';
import { householdRoutes } from './households.ts';
import { joinRoutes } from './join.ts';
import type { RateLimit } from './rate-limit.ts';
import { syncRoutes } from './sync.ts';
import { todayRoutes } from './today.ts';

export type AppOptions = {
  verifyToken: VerifyToken;
  /** Attempts per client at the public redeem endpoint; a 6-char code must not be guessable. */
  redeemLimit?: RateLimit;
  /** Change-log rows per `/sync` page. */
  syncPageSize?: number;
};

const DEFAULT_SYNC_PAGE_SIZE = 500;
const DEFAULT_REDEEM_LIMIT: RateLimit = { max: 10, windowMs: 15 * 60 * 1000 };

export function createApp(db: Db, { verifyToken, redeemLimit, syncPageSize }: AppOptions) {
  const app = new Hono();

  app.get('/health', async (c) => {
    await db.execute(sql`select 1`);
    return c.json({ ok: true });
  });

  app.use('/me', requireClerkUser(verifyToken));
  app.use('/households/*', requireClerkUser(verifyToken));
  app.use('/households', requireClerkUser(verifyToken));
  app.route('/', householdRoutes(db));
  app.route('/', choreRoutes(db));
  app.route('/', todayRoutes(db));
  app.route('/', joinRoutes(db, redeemLimit ?? DEFAULT_REDEEM_LIMIT));
  app.route('/', syncRoutes(db, syncPageSize ?? DEFAULT_SYNC_PAGE_SIZE));

  return app;
}
