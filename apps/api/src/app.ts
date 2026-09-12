import { sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { noAnalytics, type Analytics } from './analytics.ts';
import { requireClerkUser, type VerifyToken } from './auth.ts';
import type { Db } from './db/client.ts';
import { choreRoutes } from './chores.ts';
import { householdRoutes } from './households.ts';
import { joinRoutes } from './join.ts';
import { parentDeviceRoutes } from './parent-devices.ts';
import { pinRoutes } from './pin.ts';
import type { RateLimit } from './rate-limit.ts';
import { redemptionRoutes } from './redemptions.ts';
import { rejectionRoutes } from './rejection.ts';
import { rewardRoutes } from './rewards.ts';
import { syncRoutes } from './sync.ts';
import { todayRoutes } from './today.ts';
import { uploadRoutes, type R2Config } from './uploads.ts';
import { weekRoutes } from './week.ts';

export type AppOptions = {
  verifyToken: VerifyToken;
  /** Attempts per client at the public redeem endpoint; a 6-char code must not be guessable. */
  redeemLimit?: RateLimit;
  /** Change-log rows per `/sync` page. */
  syncPageSize?: number;
  /** Where server events go; nothing is sent when this is left out (ADR-0009). */
  analytics?: Analytics;
  /** Private R2 bucket used for 30-day Photo Proof objects. */
  r2?: R2Config;
};

const DEFAULT_SYNC_PAGE_SIZE = 500;
const DEFAULT_REDEEM_LIMIT: RateLimit = { max: 10, windowMs: 15 * 60 * 1000 };

export function createApp(
  db: Db,
  { verifyToken, redeemLimit, syncPageSize, analytics = noAnalytics, r2 }: AppOptions,
) {
  const app = new Hono();

  app.get('/health', async (c) => {
    await db.execute(sql`select 1`);
    return c.json({ ok: true });
  });

  app.use('/me', requireClerkUser(verifyToken));
  app.use('/households/*', requireClerkUser(verifyToken));
  app.use('/households', requireClerkUser(verifyToken));
  app.route('/', householdRoutes(db, analytics));
  app.route('/', choreRoutes(db, analytics));
  app.route('/', parentDeviceRoutes(db));
  app.route('/', pinRoutes(db));
  app.route('/', todayRoutes(db));
  app.route('/', weekRoutes(db));
  app.route('/', rejectionRoutes(db));
  app.route('/', rewardRoutes(db));
  app.route('/', redemptionRoutes(db, analytics));
  app.route('/', joinRoutes(db, redeemLimit ?? DEFAULT_REDEEM_LIMIT, analytics));
  app.route('/', syncRoutes(db, syncPageSize ?? DEFAULT_SYNC_PAGE_SIZE));
  app.route('/', uploadRoutes(db, r2));

  return app;
}
