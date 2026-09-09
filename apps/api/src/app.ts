import { sql } from 'drizzle-orm';
import { Hono } from 'hono';
import type { Db } from './db/client.ts';

export function createApp(db: Db) {
  const app = new Hono();

  app.get('/health', async (c) => {
    await db.execute(sql`select 1`);
    return c.json({ ok: true });
  });

  return app;
}
