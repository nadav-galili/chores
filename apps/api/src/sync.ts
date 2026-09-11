import { choreDate, instanceWindow, syncRequestSchema, type SyncResponse } from '@chores/shared';
import { and, asc, eq, gt, inArray, or, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { applyOps, reconcileChild, type OpContext } from './apply-ops.ts';
import type { Db } from './db/client.ts';
import { changeLog, choreAssignees, chores, households } from './db/schema.ts';
import { materializable, writeInstances } from './materialize.ts';
import { requireKidDevice, type DeviceEnv } from './device-auth.ts';
import { parseBody } from './parse-body.ts';

/**
 * The only tables a kid device sees the whole household of. Everything else is filtered to the
 * token's own child, so sibling isolation stays structural for the rows that matter — this is the
 * one deliberate hole in it, and it exists because a grove with one tree in it is not a grove
 * (ADR-0011, docs/spec/03-sync.md).
 *
 * The change log carries whole rows, so a sibling's `children` row crosses entire — first name,
 * pet name, ui mode, sort, reminder time, and `read_only_after`, which the device drops as a
 * column it does not have. All of it is household-internal and none of it is a secret: device
 * tokens live on `child_devices`, which has no change-log trigger at all. What still never
 * crosses is a sibling's chores, coins, completions, xp, day summaries and instances — those stay
 * filtered by `child_id`, and `sync.test.ts` holds that line.
 *
 * `rewards` is here for a different reason and is not a third hole in sibling isolation: it is
 * the household's reward catalog, not one child's data. Its rows carry no `child_id` at all, so
 * the trigger logs them with a NULL one and the child predicate would never match them; without
 * this entry the shop would be empty on every device. Nothing about a sibling is in a reward.
 * `redemptions` are a child's own and stay filtered by `child_id`.
 *
 * The household predicate below is now the only thing bounding these tables. It was
 * belt-and-braces while every row was pinned to one child id; it is load-bearing now.
 */
const HOUSEHOLD_WIDE = ['children', 'growth_entries', 'rewards'] as const;

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

/** Today's instances for one child, created if missing (ADR-0003). */
async function materializeToday(
  tx: Tx,
  household: typeof households.$inferSelect,
  childId: string,
  assigned: ChoreRow[],
  now: Date,
) {
  const today = choreDate(now, household.tz, household.dayBoundaryHour);
  await writeInstances(
    tx,
    assigned.map((r) => materializable(r, [childId])),
    today,
  );
  return today;
}

/**
 * `POST /sync` for a kid device (docs/spec/03-sync.md): apply the outbox, then return the change
 * log since `cursor`, filtered server-side to what this one child may see, so sibling isolation is
 * structural. Ops land before the pull, so their rows come back in the same response.
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

    const now = new Date();
    const response = await db.transaction(async (tx) => {
      const [household] = await tx.select().from(households).where(eq(households.id, householdId));
      const ctx: OpContext = {
        deviceId: c.get('deviceId'),
        childId,
        householdId,
        household: household!,
        now,
        createdBy: childId,
      };
      // Materialize first: what is due today decides whether a tap completes the day, so the
      // ops must land against the full list, not whatever happened to exist already.
      const assigned = await assignedChores(tx, childId);
      const today = await materializeToday(tx, household!, childId, assigned, now);

      const applied = await applyOps(tx, ctx, ops);
      if (applied.changed) await reconcileChild(tx, ctx);

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
              inArray(changeLog.table, [...HOUSEHOLD_WIDE]),
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
        acked: applied.acked,
        rejected: applied.rejected,
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
