import {
  materializeInstances,
  redoWindowStart,
  type IsoDate,
  type InstanceStatus,
  type MaterializableChore,
  type SyncChange,
  type SyncResponse,
} from '@chores/shared';
import { and, asc, eq, getTableColumns, gte, isNull, lt, sql } from 'drizzle-orm';
import { getTableConfig, type SQLiteTable } from 'drizzle-orm/sqlite-core';
import { choreAssignees, choreInstances, chores, syncState, syncedTables } from '@/db/schema';
import type { DeviceDb } from '@/db/types';

/**
 * The device side of `/sync` (docs/spec/03-sync.md): applies pulled change-log pages to SQLite
 * and materializes today's instances on open. Pure data in, rows out; no network in here.
 */

const STATE_ROW = 1;

/** Explicit BEGIN/COMMIT so the same code runs on the sync (expo) and async (test) drivers. */
export async function inTransaction<T>(db: DeviceDb, fn: () => Promise<T>): Promise<T> {
  await db.run(sql`begin`);
  try {
    const result = await fn();
    await db.run(sql`commit`);
    return result;
  } catch (e) {
    await db.run(sql`rollback`);
    throw e;
  }
}

/** Keeps only the columns this table has; the server may grow columns before the app does. */
function knownColumns(table: SQLiteTable, row: Record<string, unknown>): Record<string, unknown> {
  const columns = getTableColumns(table);
  return Object.fromEntries(Object.entries(row).filter(([key]) => key in columns));
}

/** The primary-key columns of a table, single or composite. */
function primaryKeyOf(table: SQLiteTable) {
  const config = getTableConfig(table);
  const composite = config.primaryKeys[0]?.columns;
  return composite?.length ? composite : config.columns.filter((c) => c.primary);
}

async function applyChange(db: DeviceDb, change: SyncChange) {
  const table = syncedTables[change.table as keyof typeof syncedTables];
  if (!table) return;
  const row = knownColumns(table, change.row);
  const pk = primaryKeyOf(table);
  const where = and(...pk.map((c) => eq(c, row[c.name])));
  if (change.op === 'delete') {
    await db.delete(table).where(where);
    return;
  }
  const set = Object.fromEntries(
    Object.entries(row).filter(([k]) => !pk.some((c) => c.name === k)),
  );
  await db
    .insert(table)
    .values(row)
    .onConflictDoUpdate({ target: pk, set: Object.keys(set).length ? set : { ...row } });
}

export async function readCursor(db: DeviceDb): Promise<number> {
  const [row] = await db.select().from(syncState).where(eq(syncState.id, STATE_ROW));
  return row?.cursor ?? 0;
}

/** Applies one pulled page atomically: every row, then the cursor (never backwards). */
export async function applyPull(db: DeviceDb, response: SyncResponse): Promise<void> {
  await inTransaction(db, async () => {
    for (const change of response.changes) await applyChange(db, change);
    await db
      .insert(syncState)
      .values({ id: STATE_ROW, cursor: response.cursor })
      .onConflictDoUpdate({
        target: syncState.id,
        set: { cursor: sql`max(${syncState.cursor}, ${response.cursor})` },
      });
  });
}

/** The instances that should exist for `today`, created from local chores; repeats are no-ops. */
export async function materializeToday(db: DeviceDb, childId: string, today: IsoDate) {
  const rows = await db
    .select()
    .from(chores)
    .innerJoin(choreAssignees, eq(choreAssignees.chore_id, chores.id))
    .where(eq(choreAssignees.child_id, childId));
  const materializable: MaterializableChore[] = rows.map(({ chores: c }) => ({
    id: c.id,
    household_id: c.household_id,
    kind: c.kind,
    weekday_mask: c.weekday_mask,
    start_date: c.start_date,
    end_date: c.end_date,
    due_date: c.due_date,
    deleted_at: c.deleted_at,
    assignees: [childId],
  }));
  const instances = materializeInstances(materializable, today);
  if (!instances.length) return;
  await db.insert(choreInstances).values(instances).onConflictDoNothing();
}

export type TodayItem = {
  id: string;
  chore_id: string;
  title: string;
  icon: string | null;
  status: InstanceStatus;
};

/**
 * A chore a parent rejected, carrying the Chore Date it belongs to: a redo counts for that day,
 * not for today, so the date travels with the row rather than being assumed by the writer.
 */
export type RedoItem = TodayItem & { chore_date: IsoDate };

/**
 * The redos waiting below today's list: this child's `redo` instances from earlier Chore Dates
 * that are still inside the Redo Window (CONTEXT.md). The window is a bound in the query and its
 * arithmetic is the shared rule's, so an instance that has aged out simply stops being offered —
 * it never reaches a tap the server would refuse `too_late`.
 *
 * Today's own redos are not here: a rejection that lands during the day leaves the chore due on
 * today's list, which is where the child is already looking.
 */
export async function redoList(db: DeviceDb, childId: string, today: IsoDate): Promise<RedoItem[]> {
  const rows = await db
    .select({
      id: choreInstances.id,
      chore_id: choreInstances.chore_id,
      chore_date: choreInstances.chore_date,
      title: chores.title,
      icon: chores.icon,
      status: choreInstances.status,
    })
    .from(choreInstances)
    .innerJoin(chores, eq(chores.id, choreInstances.chore_id))
    .innerJoin(
      choreAssignees,
      and(
        eq(choreAssignees.chore_id, choreInstances.chore_id),
        eq(choreAssignees.child_id, choreInstances.child_id),
      ),
    )
    .where(
      and(
        eq(choreInstances.child_id, childId),
        eq(choreInstances.status, 'redo'),
        lt(choreInstances.chore_date, today),
        gte(choreInstances.chore_date, redoWindowStart(today)),
        isNull(chores.deleted_at),
      ),
    )
    .orderBy(asc(choreInstances.chore_date), asc(chores.title));
  return rows;
}

/** What the child sees today: this child's instances whose chore is still theirs, by title. */
export async function todayList(
  db: DeviceDb,
  childId: string,
  today: IsoDate,
): Promise<TodayItem[]> {
  return db
    .select({
      id: choreInstances.id,
      chore_id: choreInstances.chore_id,
      title: chores.title,
      icon: chores.icon,
      status: choreInstances.status,
    })
    .from(choreInstances)
    .innerJoin(chores, eq(chores.id, choreInstances.chore_id))
    .innerJoin(
      choreAssignees,
      and(
        eq(choreAssignees.chore_id, choreInstances.chore_id),
        eq(choreAssignees.child_id, choreInstances.child_id),
      ),
    )
    .where(
      and(
        eq(choreInstances.child_id, childId),
        eq(choreInstances.chore_date, today),
        isNull(chores.deleted_at),
      ),
    )
    .orderBy(asc(chores.title));
}
