import { beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import {
  bonusId,
  choreDate,
  COINS_PER_CHORE,
  DAY_COMPLETE_BONUS,
  earnId,
  growthId,
  instanceId,
  uuid7,
  weekdayOf,
  type DeviceSession,
  type SyncResponse,
} from '@chores/shared';
import { createApp } from './app.ts';
import type { Db } from './db/client.ts';
import {
  choreInstances,
  completions,
  daySummaries,
  growthEntries,
  ledgerEntries,
  xpEvents,
} from './db/schema.ts';
import { asParent, fakeVerifyToken } from './test/auth.ts';
import { freshDb } from './test/db.ts';

let db: Db;
let app: ReturnType<typeof createApp>;

beforeAll(async () => {
  db = await freshDb();
  app = createApp(db, { verifyToken: fakeVerifyToken, redeemLimit: { max: 1000, windowMs: 1000 } });
});

const TZ = 'Asia/Jerusalem';
const today = () => choreDate(new Date(), TZ, 0);

/** A household with two children on kid devices, plus a helper to write chores as the parent. */
async function setup(clerkUserId: string) {
  const res = await app.request(
    '/households',
    asParent(clerkUserId, {
      method: 'POST',
      body: JSON.stringify({ name: 'Galili', tz: TZ, currency: 'ILS' }),
    }),
  );
  const { household } = (await res.json()) as { household: { id: string } };
  const joined: { id: string; session: DeviceSession }[] = [];
  for (const first_name of ['Noa', 'Ori']) {
    const c = await app.request(
      `/households/${household.id}/children`,
      asParent(clerkUserId, {
        method: 'POST',
        body: JSON.stringify({ first_name, ui_mode: 'little', pet_name: 'Pip' }),
      }),
    );
    const child = (await c.json()) as { id: string };
    const issued = (await (
      await app.request(
        `/households/${household.id}/children/${child.id}/join-code`,
        asParent(clerkUserId, { method: 'POST' }),
      )
    ).json()) as { code: string };
    const redeemed = await app.request('/join-codes/redeem', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: issued.code, platform: 'android' }),
    });
    joined.push({ id: child.id, session: (await redeemed.json()) as DeviceSession });
  }
  const addChore = async (title: string, assignees: string[]) => {
    const choreId = uuid7();
    await app.request(
      `/households/${household.id}/chores/${choreId}`,
      asParent(clerkUserId, {
        method: 'PUT',
        body: JSON.stringify({
          fields: { title, kind: 'daily', assignees },
          updated_at: new Date().toISOString(),
        }),
      }),
    );
    return choreId;
  };
  const deleteChore = (choreId: string) =>
    app.request(
      `/households/${household.id}/chores/${choreId}`,
      asParent(clerkUserId, {
        method: 'DELETE',
        body: JSON.stringify({ updated_at: new Date().toISOString() }),
      }),
    );
  return { householdId: household.id, noa: joined[0]!, ori: joined[1]!, addChore, deleteChore };
}

async function sync(session: DeviceSession, ops: unknown[] = [], cursor = 0) {
  const res = await app.request('/sync', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${session.device_token}`,
    },
    body: JSON.stringify({ device_id: session.device_id, cursor, ops }),
  });
  return { status: res.status, body: (await res.json()) as SyncResponse };
}

const completeOp = (choreId: string, over: Record<string, unknown> = {}) => ({
  op_id: uuid7(),
  type: 'complete',
  payload: {
    completion_id: uuid7(),
    chore_id: choreId,
    chore_date: today(),
    completed_at: new Date().toISOString(),
    ...over,
  },
});

const balance = async (childId: string) => {
  const rows = await db
    .select({ coins: ledgerEntries.coins })
    .from(ledgerEntries)
    .where(eq(ledgerEntries.childId, childId));
  return rows.reduce((sum, r) => sum + r.coins, 0);
};

const xpTotal = async (childId: string) => {
  const rows = await db
    .select({ xp: xpEvents.xp })
    .from(xpEvents)
    .where(eq(xpEvents.childId, childId));
  return rows.reduce((sum, r) => sum + r.xp, 0);
};

describe('POST /sync complete', () => {
  it('writes the completion, the instance, the earn entry and its xp, and returns them as changes', async () => {
    const { noa, addChore } = await setup('user_complete');
    const choreId = await addChore('Dishes', [noa.id]);
    const op = completeOp(choreId);

    const { status, body } = await sync(noa.session, [op]);
    expect(status).toBe(200);
    expect(body.acked).toEqual([{ op_id: op.op_id }]);
    expect(body.rejected).toEqual([]);

    const [completion] = await db
      .select()
      .from(completions)
      .where(eq(completions.id, op.payload.completion_id));
    expect(completion).toMatchObject({
      childId: noa.id,
      choreId,
      choreDate: today(),
      status: 'accepted',
      instanceId: instanceId(choreId, noa.id, today()),
      deviceId: noa.session.device_id,
    });

    const [instance] = await db
      .select()
      .from(choreInstances)
      .where(eq(choreInstances.id, instanceId(choreId, noa.id, today())));
    expect(instance!.status).toBe('done');

    const [earn] = await db
      .select()
      .from(ledgerEntries)
      .where(eq(ledgerEntries.id, earnId(op.payload.completion_id)));
    expect(earn).toMatchObject({ kind: 'earn', coins: COINS_PER_CHORE, childId: noa.id });
    expect(await xpTotal(noa.id)).toBe(COINS_PER_CHORE + DAY_COMPLETE_BONUS);

    const tables = new Set(body.changes.map((c) => c.table));
    expect(tables).toContain('completions');
    expect(tables).toContain('ledger_entries');
    expect(tables).toContain('day_summaries');
    expect(tables).toContain('xp_events');
  });

  it('is a no-op when the same op is replayed, whatever the device thinks', async () => {
    const { noa, addChore } = await setup('user_replay');
    const choreId = await addChore('Dishes', [noa.id]);
    const op = completeOp(choreId);

    const first = await sync(noa.session, [op]);
    const after = await balance(noa.id);
    const second = await sync(noa.session, [op], first.body.cursor);

    expect(second.body.acked).toEqual([{ op_id: op.op_id }]);
    expect(await balance(noa.id)).toBe(after);
    // Nothing changed, so the replay produces no new change-log rows either.
    expect(second.body.changes).toEqual([]);
    const entries = await db.select().from(ledgerEntries).where(eq(ledgerEntries.childId, noa.id));
    expect(new Set(entries.map((e) => e.id)).size).toBe(entries.length);
  });

  it('pays the day bonus and plants a tree once the day is complete', async () => {
    const { noa, addChore } = await setup('user_bonus');
    const a = await addChore('Dishes', [noa.id]);
    const b = await addChore('Bed', [noa.id]);

    await sync(noa.session, [completeOp(a)]);
    const [partial] = await db
      .select()
      .from(daySummaries)
      .where(and(eq(daySummaries.childId, noa.id), eq(daySummaries.choreDate, today())));
    expect(partial).toMatchObject({ dueCount: 2, doneCount: 1, complete: false, streakAfter: 0 });
    expect(await balance(noa.id)).toBe(COINS_PER_CHORE);

    await sync(noa.session, [completeOp(b)]);
    const [full] = await db
      .select()
      .from(daySummaries)
      .where(and(eq(daySummaries.childId, noa.id), eq(daySummaries.choreDate, today())));
    expect(full).toMatchObject({ dueCount: 2, doneCount: 2, complete: true, streakAfter: 1 });
    expect(await balance(noa.id)).toBe(2 * COINS_PER_CHORE + DAY_COMPLETE_BONUS);

    const trees = await db.select().from(growthEntries).where(eq(growthEntries.childId, noa.id));
    expect(trees.map((t) => t.id)).toEqual([growthId(noa.id, today())]);
  });

  it('accepts and pays a completion of a chore the parent deleted', async () => {
    const { noa, addChore, deleteChore } = await setup('user_deleted');
    const choreId = await addChore('Gone', [noa.id]);
    await sync(noa.session, []); // materializes today's instance
    await deleteChore(choreId);

    const op = completeOp(choreId);
    const { body } = await sync(noa.session, [op]);
    expect(body.acked).toEqual([{ op_id: op.op_id }]);
    expect(await balance(noa.id)).toBe(COINS_PER_CHORE + DAY_COMPLETE_BONUS);
  });

  it('overrides a chore date more than a day out and flags the ack', async () => {
    const { noa, addChore } = await setup('user_clock');
    const choreId = await addChore('Dishes', [noa.id]);
    const op = completeOp(choreId, { chore_date: '2020-01-01' });

    const { body } = await sync(noa.session, [op]);
    expect(body.acked).toEqual([{ op_id: op.op_id, date_adjusted: true }]);

    const [completion] = await db
      .select()
      .from(completions)
      .where(eq(completions.id, op.payload.completion_id));
    expect(completion!.choreDate).toBe(today());
  });

  it('trusts a chore date a day out', async () => {
    const { noa, addChore } = await setup('user_clock_ok');
    const choreId = await addChore('Dishes', [noa.id]);
    const yesterday = choreDate(new Date(Date.now() - 86_400_000), TZ, 0);
    const op = completeOp(choreId, { chore_date: yesterday });

    const { body } = await sync(noa.session, [op]);
    expect(body.acked).toEqual([{ op_id: op.op_id }]);
    const [completion] = await db
      .select()
      .from(completions)
      .where(eq(completions.id, op.payload.completion_id));
    expect(completion!.choreDate).toBe(yesterday);
  });

  it('refuses a chore that is not this child’s', async () => {
    const { noa, ori, addChore } = await setup('user_siblings');
    const orisChore = await addChore('Trash', [ori.id]);
    const op = completeOp(orisChore);

    const { body } = await sync(noa.session, [op]);
    expect(body.rejected).toEqual([{ op_id: op.op_id, reason: 'unknown_chore' }]);
    expect(await balance(noa.id)).toBe(0);
  });

  it('refuses a payload it cannot read and an op type it does not know', async () => {
    const { noa } = await setup('user_bad_ops');
    const bad = { op_id: uuid7(), type: 'complete', payload: {} };
    const unknown = { op_id: uuid7(), type: 'reject_completion', payload: {} };
    const { body } = await sync(noa.session, [bad, unknown]);
    expect(body.rejected).toEqual([
      { op_id: bad.op_id, reason: 'invalid_payload' },
      { op_id: unknown.op_id, reason: 'unknown_op' },
    ]);
  });
});

describe('POST /sync uncomplete', () => {
  it('claws the coins and xp back to zero and returns the instance to due', async () => {
    const { noa, addChore } = await setup('user_undo');
    const choreId = await addChore('Dishes', [noa.id]);
    const done = completeOp(choreId);
    await sync(noa.session, [done]);
    expect(await balance(noa.id)).toBe(COINS_PER_CHORE + DAY_COMPLETE_BONUS);

    const undo = {
      op_id: uuid7(),
      type: 'uncomplete',
      payload: { completion_id: done.payload.completion_id },
    };
    const { body } = await sync(noa.session, [undo]);
    expect(body.acked).toEqual([{ op_id: undo.op_id }]);
    expect(await balance(noa.id)).toBe(0);
    expect(await xpTotal(noa.id)).toBe(0);

    const [instance] = await db
      .select()
      .from(choreInstances)
      .where(eq(choreInstances.id, instanceId(choreId, noa.id, today())));
    expect(instance!.status).toBe('due');
    const [completion] = await db
      .select()
      .from(completions)
      .where(eq(completions.id, done.payload.completion_id));
    expect(completion!.status).toBe('undone');
  });

  it('never claws back the tree the day already grew', async () => {
    const { noa, addChore } = await setup('user_undo_tree');
    const choreId = await addChore('Dishes', [noa.id]);
    const done = completeOp(choreId);
    await sync(noa.session, [done]);
    await sync(noa.session, [
      {
        op_id: uuid7(),
        type: 'uncomplete',
        payload: { completion_id: done.payload.completion_id },
      },
    ]);
    const trees = await db.select().from(growthEntries).where(eq(growthEntries.childId, noa.id));
    expect(trees.map((t) => t.id)).toEqual([growthId(noa.id, today())]);
  });

  it('re-completing after an undo pays again, through a new completion', async () => {
    const { noa, addChore } = await setup('user_redo');
    const choreId = await addChore('Dishes', [noa.id]);
    const first = completeOp(choreId);
    await sync(noa.session, [first]);
    await sync(noa.session, [
      {
        op_id: uuid7(),
        type: 'uncomplete',
        payload: { completion_id: first.payload.completion_id },
      },
    ]);
    const second = completeOp(choreId);
    await sync(noa.session, [second]);

    expect(await balance(noa.id)).toBe(COINS_PER_CHORE + DAY_COMPLETE_BONUS);
    const [bonus] = await db
      .select()
      .from(ledgerEntries)
      .where(eq(ledgerEntries.id, bonusId(noa.id, today())));
    expect(bonus).toBeDefined();
  });

  it('refuses a completion that is not this child’s and one it has never seen', async () => {
    const { noa, ori, addChore } = await setup('user_undo_other');
    const orisChore = await addChore('Trash', [ori.id]);
    const orisDone = completeOp(orisChore);
    await sync(ori.session, [orisDone]);

    const stealing = {
      op_id: uuid7(),
      type: 'uncomplete',
      payload: { completion_id: orisDone.payload.completion_id },
    };
    const missing = { op_id: uuid7(), type: 'uncomplete', payload: { completion_id: uuid7() } };
    const { body } = await sync(noa.session, [stealing, missing]);
    expect(body.rejected).toEqual([
      { op_id: stealing.op_id, reason: 'unknown_completion' },
      { op_id: missing.op_id, reason: 'unknown_completion' },
    ]);
    expect(await balance(ori.id)).toBe(COINS_PER_CHORE + DAY_COMPLETE_BONUS);
  });

  it('refuses an undo of a day that has passed', async () => {
    const { noa, addChore } = await setup('user_undo_late');
    const choreId = await addChore('Dishes', [noa.id]);
    const yesterday = choreDate(new Date(Date.now() - 86_400_000), TZ, 0);
    const done = completeOp(choreId, {
      chore_date: yesterday,
      completed_at: new Date(Date.now() - 86_400_000).toISOString(),
    });
    await sync(noa.session, [done]);

    const undo = {
      op_id: uuid7(),
      type: 'uncomplete',
      payload: { completion_id: done.payload.completion_id },
    };
    const { body } = await sync(noa.session, [undo]);
    expect(body.rejected).toEqual([{ op_id: undo.op_id, reason: 'too_late' }]);
  });
});

describe('POST /sync op ordering', () => {
  it('lands the same ledger sum whichever order a batch of ops arrives in', async () => {
    const { noa, addChore } = await setup('user_order_a');
    const a = await addChore('Dishes', [noa.id]);
    const b = await addChore('Bed', [noa.id]);
    const doneA = completeOp(a);
    const doneB = completeOp(b);
    const undoA = {
      op_id: uuid7(),
      type: 'uncomplete',
      payload: { completion_id: doneA.payload.completion_id },
    };

    await sync(noa.session, [doneA, doneB, undoA]);
    // Dishes undone, Bed done: one earn, no day bonus.
    expect(await balance(noa.id)).toBe(COINS_PER_CHORE);

    // The same ops replayed out of order and duplicated change nothing.
    await sync(noa.session, [undoA, doneB, doneA, undoA]);
    expect(await balance(noa.id)).toBe(COINS_PER_CHORE);
  });

  it('applies an undo that arrives in the same batch as its completion', async () => {
    const { noa, addChore } = await setup('user_order_b');
    const choreId = await addChore('Dishes', [noa.id]);
    const done = completeOp(choreId);
    const undo = {
      op_id: uuid7(),
      type: 'uncomplete',
      payload: { completion_id: done.payload.completion_id },
    };
    const { body } = await sync(noa.session, [done, undo]);
    expect(body.rejected).toEqual([]);
    expect(await balance(noa.id)).toBe(0);
  });
});

describe('POST /sync chore dates the recurrence does not allow', () => {
  it('files a completion on the server’s own date when the claimed day is not one the chore falls on', async () => {
    const { noa, householdId } = await setup('user_weekday');
    // A chore due only on the weekday of today: yesterday is inside the ±1 day tolerance but is
    // not a day this chore is ever due, so accepting it there would leave a day forever incomplete.
    const choreId = uuid7();
    const mask = 1 << weekdayOf(today());
    await app.request(
      `/households/${householdId}/chores/${choreId}`,
      asParent('user_weekday', {
        method: 'PUT',
        body: JSON.stringify({
          fields: { title: 'Bins', kind: 'weekdays', weekday_mask: mask, assignees: [noa.id] },
          updated_at: new Date().toISOString(),
        }),
      }),
    );
    const yesterday = choreDate(new Date(Date.now() - 86_400_000), TZ, 0);
    const op = completeOp(choreId, { chore_date: yesterday });

    const { body } = await sync(noa.session, [op]);
    expect(body.acked).toEqual([{ op_id: op.op_id, date_adjusted: true }]);

    const [completion] = await db
      .select()
      .from(completions)
      .where(eq(completions.id, op.payload.completion_id));
    expect(completion!.choreDate).toBe(today());
    const stray = await db
      .select()
      .from(choreInstances)
      .where(and(eq(choreInstances.childId, noa.id), eq(choreInstances.choreDate, yesterday)));
    expect(stray).toEqual([]);
    // Today is complete, so the bonus and the tree still land.
    expect(await balance(noa.id)).toBe(COINS_PER_CHORE + DAY_COMPLETE_BONUS);
  });
});
