import { drizzle } from 'drizzle-orm/expo-sqlite';
import { migrate } from 'drizzle-orm/expo-sqlite/migrator';
import { deleteDatabaseSync, openDatabaseSync } from 'expo-sqlite';
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

/** A revoked device wipes its local copy (docs/spec/03-sync.md, conflict rules). */
export async function wipeDeviceDb(): Promise<void> {
  if (opening) (await opening).close();
  opening = null;
  deleteDatabaseSync(DB_NAME);
}
