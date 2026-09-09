import { sql } from 'drizzle-orm';
import { createDb, type Db } from '../db/client.ts';
import { runMigrations } from '../db/migrate.ts';

export const TEST_DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5499/chores';

/** Drops everything and applies migrations from empty, so each test file starts clean. */
export async function freshDb(): Promise<Db> {
  const db = createDb(TEST_DATABASE_URL);
  await db.execute(sql`drop schema if exists public cascade`);
  await db.execute(sql`drop schema if exists drizzle cascade`);
  await db.execute(sql`create schema public`);
  await runMigrations(db);
  return db;
}
