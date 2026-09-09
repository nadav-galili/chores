import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import {
  bonusId,
  COINS_PER_CHORE,
  DAY_COMPLETE_BONUS,
  earnId,
  growthId,
  instanceId,
  uuid7,
  xpId,
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
  ledgerEntries,
  outbox,
  xpEvents,
} from '@/db/schema';
import { applyPull, materializeToday, todayList } from './engine';
import { balanceOf, tapContext, tapDone, tapToggle, tapUndo, type ChildContext } from './local';

let db: DeviceDb;
const childId = uuid7();
const householdId = uuid7();
const deviceId = uuid7();
const parentId = uuid7();
const T = '2026-09-09T10:00:00.000Z';
const TODAY = '2026-09-09';
const NOW = new Date(T);

const child: ChildContext = {
  householdId,
  childId,
  deviceId,
  tz: 'Asia/Jerusalem',
  dayBoundaryHour: 0,
};
const ctx = () => tapContext(child, NOW);

/** A daily chore assigned to this child, with today's instance materialized. */
async function seedChore(title = 'Dishes') {
  const id = uuid7();
  await db.insert(chores).values({
    id,
    household_id: householdId,
    title,
    icon: '🍽️',
    kind: 'daily',
    weekday_mask: null,
    start_date: null,
    end_date: null,
    due_date: null,
    requires_photo: false,
    version: 1,
    updated_at: T,
    updated_by: parentId,
    deleted_at: null,
    field_clocks: {},
  });
  await db.insert(choreAssignees).values({ chore_id: id, child_id: childId });
  await materializeToday(db, childId, TODAY);
  return { chore_id: id, id: instanceId(id, childId, TODAY) };
}

beforeEach(async () => {
  db = await openTestDb();
});

describe('tapDone', () => {
  it('writes the completion, the instance, the coins, the xp, the day and the outbox op at once', async () => {
    const instance = await seedChore();
    await tapDone(db, ctx(), instance);

    const [completion] = await db.select().from(completions);
    expect(completion).toMatchObject({
      instance_id: instance.id,
      chore_id: instance.chore_id,
      child_id: childId,
      household_id: householdId,
      chore_date: TODAY,
      completed_at: T,
      device_id: deviceId,
      status: 'accepted',
    });

    const [row] = await db.select().from(choreInstances).where(eq(choreInstances.id, instance.id));
    expect(row!.status).toBe('done');

    const entries = await db.select().from(ledgerEntries);
    expect(entries.map((e) => e.id).sort()).toEqual(
      [earnId(completion!.id), bonusId(childId, TODAY)].sort(),
    );
    expect(await balanceOf(db, childId)).toBe(COINS_PER_CHORE + DAY_COMPLETE_BONUS);

    const xp = await db.select().from(xpEvents);
    expect(xp.map((x) => x.id).sort()).toEqual(entries.map((e) => xpId(e.id)).sort());
    expect(xp.reduce((sum, x) => sum + x.xp, 0)).toBe(COINS_PER_CHORE + DAY_COMPLETE_BONUS);

    const [summary] = await db.select().from(daySummaries);
    expect(summary).toMatchObject({
      chore_date: TODAY,
      due_count: 1,
      done_count: 1,
      complete: true,
      streak_after: 1,
    });
    expect((await db.select().from(growthEntries)).map((g) => g.id)).toEqual([
      growthId(childId, TODAY),
    ]);

    const [op] = await db.select().from(outbox);
    expect(op).toMatchObject({ type: 'complete', status: 'pending', attempts: 0 });
    expect(op!.payload).toEqual({
      completion_id: completion!.id,
      chore_id: instance.chore_id,
      chore_date: TODAY,
      completed_at: T,
    });
  });

  it('pays the day bonus only once every chore of the day is done', async () => {
    const a = await seedChore('Dishes');
    const b = await seedChore('Bed');

    await tapDone(db, ctx(), a);
    expect(await balanceOf(db, childId)).toBe(COINS_PER_CHORE);
    const [partial] = await db.select().from(daySummaries);
    expect(partial).toMatchObject({ due_count: 2, done_count: 1, complete: false });

    await tapDone(db, ctx(), b);
    expect(await balanceOf(db, childId)).toBe(2 * COINS_PER_CHORE + DAY_COMPLETE_BONUS);
  });

  it('shows the instance as done on the list the child is looking at', async () => {
    const instance = await seedChore();
    await tapDone(db, ctx(), instance);
    expect((await todayList(db, childId, TODAY)).map((i) => i.status)).toEqual(['done']);
  });
});

describe('tapUndo', () => {
  it('takes the coins and the xp back and returns the instance to due', async () => {
    const instance = await seedChore();
    await tapDone(db, ctx(), instance);
    await tapUndo(db, ctx(), instance);

    expect(await balanceOf(db, childId)).toBe(0);
    const xp = await db.select().from(xpEvents);
    expect(xp.reduce((sum, x) => sum + x.xp, 0)).toBe(0);

    const [row] = await db.select().from(choreInstances).where(eq(choreInstances.id, instance.id));
    expect(row!.status).toBe('due');
    const [completion] = await db.select().from(completions);
    expect(completion!.status).toBe('undone');

    const ops = await db.select().from(outbox);
    expect(ops.map((o) => o.type)).toEqual(['complete', 'uncomplete']);
    expect(ops[1]!.payload).toEqual({ completion_id: completion!.id });
  });

  it('leaves the tree standing: a day that grew is never clawed back', async () => {
    const instance = await seedChore();
    await tapDone(db, ctx(), instance);
    await tapUndo(db, ctx(), instance);
    expect((await db.select().from(growthEntries)).map((g) => g.id)).toEqual([
      growthId(childId, TODAY),
    ]);
  });

  it('a second tap undoes and a third pays again, through a new completion', async () => {
    const instance = await seedChore();
    await tapToggle(db, ctx(), { ...instance, status: 'due' });
    await tapToggle(db, ctx(), { ...instance, status: 'done' });
    await tapToggle(db, ctx(), { ...instance, status: 'due' });

    expect(await balanceOf(db, childId)).toBe(COINS_PER_CHORE + DAY_COMPLETE_BONUS);
    const rows = await db.select().from(completions);
    expect(rows.map((c) => c.status).sort()).toEqual(['accepted', 'undone']);
  });
});

describe('the server writing the same facts', () => {
  it('produces rows the device already has, so a pull changes nothing', async () => {
    const instance = await seedChore();
    await tapDone(db, ctx(), instance);

    const before = {
      completions: await db.select().from(completions),
      entries: await db.select().from(ledgerEntries),
      xp: await db.select().from(xpEvents),
      summaries: await db.select().from(daySummaries),
      growth: await db.select().from(growthEntries),
      balance: await balanceOf(db, childId),
    };

    // What `/sync` sends back after applying the very op this device queued: the same ids, from
    // the same shared rules, with the server's own timestamps.
    const completion = before.completions[0]!;
    const serverAt = '2026-09-09T10:00:03.000Z';
    let seq = 0;
    const change = (table: string, row: Record<string, unknown>): SyncChange => ({
      seq: ++seq,
      table,
      row_id: (row.id as string) ?? childId,
      op: 'insert',
      row,
    });
    const response: SyncResponse = {
      acked: [],
      rejected: [],
      changes: [
        change('completions', { ...completion, created_at: serverAt }),
        change('chore_instances', {
          id: instance.id,
          chore_id: instance.chore_id,
          child_id: childId,
          household_id: householdId,
          chore_date: TODAY,
          status: 'done',
        }),
        ...before.entries.map((e) => change('ledger_entries', { ...e, created_at: serverAt })),
        ...before.xp.map((x) => change('xp_events', { ...x, created_at: serverAt })),
        ...before.summaries.map((s) => change('day_summaries', { ...s })),
        ...before.growth.map((g) => change('growth_entries', { ...g, created_at: serverAt })),
      ],
      cursor: 99,
      has_more: false,
    };
    await applyPull(db, response);

    expect(await balanceOf(db, childId)).toBe(before.balance);
    expect(await db.select().from(ledgerEntries)).toHaveLength(before.entries.length);
    expect(await db.select().from(xpEvents)).toHaveLength(before.xp.length);
    expect(await db.select().from(growthEntries)).toHaveLength(before.growth.length);
    expect(await db.select().from(daySummaries)).toEqual(before.summaries);
    const [row] = await db.select().from(choreInstances).where(eq(choreInstances.id, instance.id));
    expect(row!.status).toBe('done');
  });
});
