import {
  choreDate,
  instanceWindow,
  materializeInstances,
  syncRequestSchema,
  type MaterializableChore,
  type SyncResponse,
} from '@chores/shared';
import { and, asc, eq, gt, inArray, or, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import type { Db } from './db/client.ts';
import { changeLog, choreAssignees, choreInstances, chores, households } from './db/schema.ts';
import { requireKidDevice, type DeviceEnv } from './device-auth.ts';
import { parseBody } from './parse-body.ts';

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
type ChoreRow = typeof chores.$inferSelect;

/**
 * The chores assigned to `childId`, deleted ones included: a device that holds a chore must
 * still learn it was deleted, and an unassignment reaches it as the assignee row's delete.
 */
async function assignedChores(tx: Tx, childId: string) {
  const rows = await tx
    .select()
    .from(chores)
    .innerJoin(choreAssignees, eq(choreAssignees.choreId, chores.id))
    .where(eq(choreAssignees.childId, childId));
  return rows.map((r) => r.chores);
}

/**
 * Today's instances for one child, created if missing. Deterministic ids make a repeat, or a
 * race with the device or the cron, a no-op (ADR-0003).
 */
async function materializeToday(
  tx: Tx,
  householdId: string,
  childId: string,
  assigned: ChoreRow[],
  now: Date,
) {
  const [household] = await tx.select().from(households).where(eq(households.id, householdId));
  const today = choreDate(now, household!.tz, household!.dayBoundaryHour);
  const materializable: MaterializableChore[] = assigned.map((r) => ({
    id: r.id,
    household_id: r.householdId,
    kind: r.kind,
    weekday_mask: r.weekdayMask,
    start_date: r.startDate,
    end_date: r.endDate,
    due_date: r.dueDate,
    deleted_at: r.deletedAt ? r.deletedAt.toISOString() : null,
    assignees: [childId],
  }));
  const instances = materializeInstances(materializable, today);
  if (instances.length) {
    await tx
      .insert(choreInstances)
      .values(
        instances.map((i) => ({
          id: i.id,
          choreId: i.chore_id,
          childId: i.child_id,
          householdId: i.household_id,
          choreDate: i.chore_date,
          status: i.status,
        })),
      )
      .onConflictDoNothing();
  }
  return today;
}

/**
 * `POST /sync` for a kid device (docs/spec/03-sync.md). Pull only for now: the change log since
 * `cursor`, filtered server-side to what this one child may see, so sibling isolation is structural.
 */
export function syncRoutes(db: Db, pageSize: number) {
  const app = new Hono<DeviceEnv>();
  app.use('/sync', requireKidDevice(db));

  app.post('/sync', async (c) => {
    const body = await parseBody(c, syncRequestSchema);
    if (!body.ok) return body.response;
    if (body.data.device_id !== c.get('deviceId')) {
      return c.json({ error: 'device_mismatch' }, 403);
    }
    const childId = c.get('childId');
    const householdId = c.get('householdId');
    const { cursor, ops } = body.data;

    const response = await db.transaction(async (tx) => {
      const assigned = await assignedChores(tx, childId);
      const today = await materializeToday(tx, householdId, childId, assigned, new Date());
      const window = instanceWindow(today);
      const visibleChores = assigned.map((r) => r.id);

      const rows = await tx
        .select()
        .from(changeLog)
        .where(
          and(
            eq(changeLog.householdId, householdId),
            gt(changeLog.seq, cursor),
            or(
              eq(changeLog.childId, childId),
              visibleChores.length
                ? and(eq(changeLog.table, 'chores'), inArray(changeLog.rowId, visibleChores))
                : sql`false`,
            ),
            or(
              sql`${changeLog.table} <> 'chore_instances'`,
              sql`(${changeLog.row}->>'chore_date') between ${window.from} and ${window.to}`,
            ),
          ),
        )
        .orderBy(asc(changeLog.seq))
        .limit(pageSize + 1);

      const page = rows.slice(0, pageSize);
      const result: SyncResponse = {
        acked: [],
        rejected: ops.map((op) => ({ op_id: op.op_id, reason: 'unknown_op' })),
        changes: page.map((r) => ({
          seq: r.seq,
          table: r.table,
          row_id: r.rowId,
          op: r.op as 'insert' | 'update' | 'delete',
          row: r.row as Record<string, unknown>,
        })),
        cursor: page.at(-1)?.seq ?? cursor,
        has_more: rows.length > pageSize,
      };
      return result;
    });
    return c.json(response);
  });

  return app;
}
