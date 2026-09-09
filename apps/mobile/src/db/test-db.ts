import { DatabaseSync } from 'node:sqlite';
import { drizzle } from 'drizzle-orm/sqlite-proxy';
import { migrate } from 'drizzle-orm/sqlite-proxy/migrator';
import path from 'node:path';
import * as schema from './schema';
import type { DeviceDb } from './types';

/**
 * Test seam 3: the same Drizzle schema over an in-memory SQLite (Node's built-in), migrated from
 * the very SQL the app bundles. Never imported by app code.
 */
export async function openTestDb(): Promise<DeviceDb> {
  const sqlite = new DatabaseSync(':memory:');
  const db = drizzle(
    async (sql, params, method) => {
      const stmt = sqlite.prepare(sql);
      if (method === 'run') {
        stmt.run(...(params as never[]));
        return { rows: [] };
      }
      const rows = stmt.all(...(params as never[])).map((r) => Object.values(r));
      return { rows: method === 'get' ? (rows[0] ?? []) : rows };
    },
    { schema },
  );
  await migrate(db, async (queries) => queries.forEach((q) => sqlite.exec(q)), {
    migrationsFolder: path.resolve(import.meta.dirname, '../../drizzle'),
  });
  return db;
}
