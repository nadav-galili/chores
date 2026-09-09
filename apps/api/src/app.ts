import { sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { requireClerkUser, type VerifyToken } from './auth.ts';
import type { Db } from './db/client.ts';
import { choreRoutes } from './chores.ts';
import { householdRoutes } from './households.ts';

export type AppOptions = { verifyToken: VerifyToken };

export function createApp(db: Db, { verifyToken }: AppOptions) {
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

  return app;
}
