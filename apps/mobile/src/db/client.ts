import { drizzle } from 'drizzle-orm/expo-sqlite';
import { migrate } from 'drizzle-orm/expo-sqlite/migrator';
import { deleteDatabaseSync, openDatabaseSync } from 'expo-sqlite';
import { syncSettled } from '@/sync/sync';
import migrations from './migrations';
import * as schema from './schema';
import type { DeviceDb } from './types';

const DB_NAME = 'mibo.db';

let opening: Promise<{ db: DeviceDb; close: () => void }> | null = null;

/** The device database, migrated on first open. One connection for the whole app. */
export async function openDeviceDb(): Promise<DeviceDb> {
  opening ??= (async () => {
    const client = openDatabaseSync(DB_NAME);
    const db = drizzle(client, { schema });
    await migrate(db, migrations);
    return { db, close: () => client.closeSync() };
  })();
  return (await opening).db;
}

let wiping: Promise<void> | null = null;

/**
 * A device that stops being a child's — revoked (docs/spec/03-sync.md, conflict rules) or let out
 * with the Parent PIN — wipes its local copy, so the next child joined on it starts from nothing
 * rather than from the last child's cursor and outbox.
 *
 * It waits for a sync run that is holding the connection, and callers that arrive together share
 * one wipe: closing a connection twice throws.
 */
export function wipeDeviceDb(): Promise<void> {
  wiping ??= (async () => {
    try {
      await syncSettled();
      const open = opening;
      opening = null;
      if (open) (await open).close();
      try {
        deleteDatabaseSync(DB_NAME);
      } catch (e) {
        // Already gone — a wipe that finished just before this one. Said, not thrown: the caller
        // still has a session to clear.
        console.error('device db delete failed', e);
      }
    } finally {
      wiping = null;
    }
  })();
  return wiping;
}
