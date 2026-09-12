import { sql } from 'drizzle-orm';
import { createDb, type Db } from '../db/client.ts';
import { runMigrations } from '../db/migrate.ts';

/**
 * Deliberately not `DATABASE_URL`. `freshDb` drops the whole `public` schema, so reading the
 * variable that points a running dev server at its database means one `pnpm test` destroys
 * whatever is in it — which is exactly what happened once. Tests address a database of their own
 * and fall back to one named `chores_test`; nothing here can reach the dev data.
 */
export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5499/chores_test';

/** Drops everything and applies migrations from empty, so each test file starts clean. */
export async function freshDb(): Promise<Db> {
  const db = createDb(TEST_DATABASE_URL);
  await db.execute(sql`drop schema if exists public cascade`);
  await db.execute(sql`drop schema if exists drizzle cascade`);
  await db.execute(sql`create schema public`);
  await runMigrations(db);
  return db;
}
