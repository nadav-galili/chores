import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core';
import type * as schema from './schema';

/**
 * The device database as the sync engine and the screens see it: the expo-sqlite driver on the
 * phone (sync), a proxy over Node's SQLite in tests (async). Every call site awaits, which is a
 * no-op on the sync driver.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type DeviceDb = BaseSQLiteDatabase<'sync' | 'async', any, typeof schema>;
