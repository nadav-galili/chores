import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import {
  COINS_PER_CHORE,
  DAY_COMPLETE_BONUS,
  addDays,
  growthId,
  instanceId,
  uuid7,
  type SyncChange,
  type SyncResponse,
} from '@chores/shared';
import { openTestDb } from '@/db/test-db';
import type { DeviceDb } from '@/db/types';
import {
  choreAssignees,
  choreInstances,
  chores,
  completions,
  daySummaries,
  growthEntries,
  outbox,
} from '@/db/schema';
import { applyPull, materializeToday, redoList, todayList } from './engine';
import { balanceOf, tapContext, tapDone, tapRedo, type ChildContext } from './local';

/**
 * Seam 3 (CLAUDE.md): the device sync engine over in-memory SQLite fed canned `/sync` responses.
 * The whole redo loop from the child's side — a rejection arrives, the chore comes back, the
 * child does it again on the day it belonged to.
 */

const childId = uuid7();
const householdId = uuid7();
const deviceId = uuid7();
const parentId = uuid7();

/** Yesterday, the Chore Date the rejected chore belongs to; the child redoes it today. */
const D = '2026-09-08';
const TODAY = '2026-09-09';
const at = (date: string) => new Date(`${date}T10:00:00.000Z`);

const child: ChildContext = {
  householdId,
  childId,
  deviceId,
  tz: 'Asia/Jerusalem',
  dayBoundaryHour: 0,
};

let seq = 0;
const change = (
  table: string,
  op: SyncChange['op'],
  row: Record<string, unknown>,
  row_id = row.id as string,
): SyncChange => ({ seq: ++seq, table, row_id, op, row });

const page = (changes: SyncChange[]): SyncResponse => ({
  acked: [],
  rejected: [],
  changes,
  cursor: changes.at(-1)?.seq ?? 0,
  has_more: false,
});

let db: DeviceDb;

async function seedChore(title: string, date: string) {
  const id = uuid7();
  await db.insert(chores).values({
    id,
    household_id: householdId,
    title,
    icon: null,
    kind: 'daily',
    weekday_mask: null,
    start_date: null,
    end_date: null,
    due_date: null,
    requires_photo: false,
    version: 1,
    updated_at: at(date).toISOString(),
    updated_by: parentId,
    deleted_at: null,
    field_clocks: {},
  });
  await db.insert(choreAssignees).values({ chore_id: id, child_id: childId });
  await materializeToday(db, childId, date);
  return { chore_id: id, id: instanceId(id, childId, date) };
}

/** What the server sends once a parent has rejected a completion: the two rows it rewrote. */
const rejection = (completionId: string, instance: { id: string; chore_id: string }) =>
  page([
    change('completions', 'update', {
      id: completionId,
      instance_id: instance.id,
      chore_id: instance.chore_id,
      child_id: childId,
      household_id: householdId,
      chore_date: D,
      completed_at: at(D).toISOString(),
      device_id: deviceId,
      status: 'rejected',
      rejected_by: parentId,
      rejected_at: at(D).toISOString(),
      created_at: at(D).toISOString(),
    }),
    change('chore_instances', 'update', {
      id: instance.id,
      chore_id: instance.chore_id,
      child_id: childId,
      household_id: householdId,
      chore_date: D,
      status: 'redo',
    }),
  ]);

/**
 * Yesterday: the child did one of the day's two chores and a parent rejected it, so the day
 * never became Day Complete. Then they did the other one. Today the first is a redo.
 */
async function yesterdayRejected() {
  const rejected = await seedChore('Dishes', D);
  const other = await seedChore('Beds', D);
  await tapDone(db, tapContext(child, at(D)), rejected);
  const [written] = await db.select().from(completions);
  await applyPull(db, rejection(written!.id, rejected));
  await tapDone(db, tapContext(child, at(D)), other);
  return { rejected, other };
}

beforeEach(async () => {
  db = await openTestDb();
  seq = 0;
});

describe('a pulled rejection', () => {
  it('surfaces the instance as a redo, below today and never in it', async () => {
    const { rejected } = await yesterdayRejected();
    await materializeToday(db, childId, TODAY);

    const redos = await redoList(db, childId, TODAY);
    expect(redos).toMatchObject([{ id: rejected.id, title: 'Dishes', chore_date: D }]);
    expect(await todayList(db, childId, TODAY)).not.toContainEqual(
      expect.objectContaining({ id: rejected.id }),
    );
    // The rejection took the day's bonus with it, so the day is not complete and grew nothing.
    expect(await db.select().from(growthEntries)).toEqual([]);
  });

  it('drops an instance that has aged out of the Redo Window', async () => {
    const { rejected } = await yesterdayRejected();
    await db
      .update(choreInstances)
      .set({ chore_date: addDays(D, -3) })
      .where(eq(choreInstances.id, rejected.id));

    expect(await redoList(db, childId, TODAY)).toEqual([]);
  });
});

describe('tapRedo', () => {
  it('writes the completion on the instance’s own Chore Date, not today', async () => {
    const { rejected } = await yesterdayRejected();
    const [item] = await redoList(db, childId, TODAY);

    await tapRedo(db, tapContext(child, at(TODAY)), item!);

    const rows = await db.select().from(completions).where(eq(completions.status, 'accepted'));
    expect(rows.map((r) => r.chore_date).sort()).toEqual([D, D]);
    const ops = await db.select().from(outbox);
    expect(ops.at(-1)).toMatchObject({
      type: 'complete',
      payload: { chore_id: rejected.chore_id, chore_date: D },
    });
  });

  it('reconciles coins, streak and the grove for that past date', async () => {
    await yesterdayRejected();
    // Two chores done, one of them clawed back: one chore's worth and no day bonus.
    expect(await balanceOf(db, childId)).toBe(COINS_PER_CHORE);
    const [item] = await redoList(db, childId, TODAY);

    const paid = await tapRedo(db, tapContext(child, at(TODAY)), item!);

    expect(paid).toBe(COINS_PER_CHORE + DAY_COMPLETE_BONUS);
    expect(await balanceOf(db, childId)).toBe(2 * COINS_PER_CHORE + DAY_COMPLETE_BONUS);
    const [summary] = await db.select().from(daySummaries).where(eq(daySummaries.chore_date, D));
    expect(summary).toMatchObject({ complete: true, streak_after: 1 });
    // A past Chore Date complete for the first time plants its tree, exactly once (ADR-0011).
    expect(await db.select().from(growthEntries)).toMatchObject([
      { id: growthId(childId, D), chore_date: D },
    ]);
    expect(await redoList(db, childId, TODAY)).toEqual([]);
  });

  it('does nothing for an instance past the Redo Window', async () => {
    const { rejected } = await yesterdayRejected();
    const before = await balanceOf(db, childId);

    const paid = await tapRedo(db, tapContext(child, at(TODAY)), {
      ...rejected,
      chore_date: addDays(TODAY, -3),
    });

    expect(paid).toBe(0);
    expect(await balanceOf(db, childId)).toBe(before);
    expect(await db.select().from(outbox).where(eq(outbox.type, 'complete'))).toHaveLength(2);
  });
});
