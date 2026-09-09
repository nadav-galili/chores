import { serve } from '@hono/node-server';
import { createApp } from './app.ts';
import { createDb } from './db/client.ts';
import { runMigrations } from './db/migrate.ts';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required');
const port = Number(process.env.PORT ?? 3000);

const db = createDb(databaseUrl);
await runMigrations(db);

serve({ fetch: createApp(db).fetch, port, hostname: '0.0.0.0' }, (info) => {
  console.log(`api listening on :${info.port}`);
});
