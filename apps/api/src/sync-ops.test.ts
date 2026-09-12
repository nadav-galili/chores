import { beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import {
  addDays,
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
} from '@chores/shared';
import { createApp } from './app.ts';
import type { Db } from './db/client.ts';
import {
  childDevices,
  choreInstances,
  completions,
  daySummaries,
  growthEntries,
  households,
  ledgerEntries,
  xpEvents,
} from './db/schema.ts';
import { writeHouseholdInstances } from './materialize.ts';
import { asParent, fakeVerifyToken } from './test/auth.ts';
import { freshDb } from './test/db.ts';
import { completeOp, setupHousehold, syncAs, testToday, TEST_TZ } from './test/household.ts';

let db: Db;
let app: ReturnType<typeof createApp>;

beforeAll(async () => {
  db = await freshDb();
  app = createApp(db, { verifyToken: fakeVerifyToken, redeemLimit: { max: 1000, windowMs: 1000 } });
});

const today = testToday;

const setup = (clerkUserId: string) => setupHousehold(app, clerkUserId);
const sync = (session: DeviceSession, ops: unknown[] = [], cursor = 0) =>
  syncAs(app, session, ops, cursor);

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

  it('accepts a completion for a photo chore after the household entitlement lapses', async () => {
    const clerkUserId = 'user_lapsed_photo';
    const { householdId, noa, addChore } = await setup(clerkUserId);
    await db
      .update(households)
      .set({ entitlement: 'premium' })
      .where(eq(households.id, householdId));
    const choreId = await addChore('Photo chore', [noa.id]);
    const setPhoto = await app.request(
      `/households/${householdId}/chores/${choreId}`,
      asParent(clerkUserId, {
        method: 'PUT',
        body: JSON.stringify({
          fields: { requires_photo: true },
          updated_at: new Date(Date.now() + 1_000).toISOString(),
        }),
      }),
    );
    expect(setPhoto.status).toBe(200);
    await db.update(households).set({ entitlement: 'free' }).where(eq(households.id, householdId));

    const op = completeOp(choreId);
    const { status, body } = await sync(noa.session, [op]);
    expect(status).toBe(200);
    expect(body.acked).toEqual([{ op_id: op.op_id }]);
    expect(body.rejected).toEqual([]);
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
    const yesterday = choreDate(new Date(Date.now() - 86_400_000), TEST_TZ, 0);
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
    const yesterday = choreDate(new Date(Date.now() - 86_400_000), TEST_TZ, 0);
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
    const yesterday = choreDate(new Date(Date.now() - 86_400_000), TEST_TZ, 0);
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

describe('POST /sync register_push_token', () => {
  const registerOp = (token: unknown) => ({
    op_id: uuid7(),
    type: 'register_push_token',
    payload: { expo_push_token: token },
  });

  const deviceToken = async (deviceId: string) => {
    const [row] = await db.select().from(childDevices).where(eq(childDevices.id, deviceId));
    return row!.expoPushToken;
  };

  it('stores the token on the device the request came from, and replaces it on re-registration', async () => {
    const { noa, ori } = await setup('user_push_token');

    const first = await sync(noa.session, [registerOp('ExponentPushToken[first]')]);
    expect(first.body.acked).toHaveLength(1);
    expect(first.body.rejected).toEqual([]);
    expect(await deviceToken(noa.session.device_id)).toBe('ExponentPushToken[first]');
    // Nothing about a sibling's device moved.
    expect(await deviceToken(ori.session.device_id)).toBeNull();

    await sync(noa.session, [registerOp('ExponentPushToken[second]')]);
    expect(await deviceToken(noa.session.device_id)).toBe('ExponentPushToken[second]');
  });

  it('refuses a token that is not an Expo one and leaves the stored one alone', async () => {
    const { noa } = await setup('user_push_token_bad');
    await sync(noa.session, [registerOp('ExponentPushToken[good]')]);

    const { body } = await sync(noa.session, [registerOp('fcm:abc')]);
    expect(body.rejected).toEqual([{ op_id: expect.any(String), reason: 'invalid_payload' }]);
    expect(await deviceToken(noa.session.device_id)).toBe('ExponentPushToken[good]');
  });

  it('pays nothing: a push token is not a completion', async () => {
    const { noa, addChore } = await setup('user_push_token_free');
    await addChore('Dishes', [noa.id]);

    await sync(noa.session, [registerOp('ExponentPushToken[free]')]);
    expect(await balance(noa.id)).toBe(0);
    expect(await xpTotal(noa.id)).toBe(0);
  });
});

/**
 * docs/spec/02-data-model.md, timezone rules: "The ±1 rule applies only when the instance would
 * have to be created" — the guard exists so a device with a wrong clock cannot invent a day, and
 * an instance the server already materialized was not invented by a device. Without this the
 * redo of a two-day-old chore would land on today's instance and stay a redo forever.
 */
describe('POST /sync complete on an instance the server already materialized', () => {
  /** A past instance the parent rejected, exactly as a rejection leaves it: due again, `redo`. */
  const pastRedo = async (clerkUserId: string, daysAgo: number) => {
    const { noa, householdId, addChore } = await setup(clerkUserId);
    const choreId = await addChore('Dishes', [noa.id]);
    const date = addDays(today(), -daysAgo);
    await writeHouseholdInstances(db, householdId, date);
    await db
      .update(choreInstances)
      .set({ status: 'redo' })
      .where(eq(choreInstances.id, instanceId(choreId, noa.id, date)));
    return { noa, choreId, date };
  };

  it('writes a two-day-old redo on that instance’s own chore date, not today’s', async () => {
    const { noa, choreId, date } = await pastRedo('user_redo_two', 2);
    const op = completeOp(choreId, { chore_date: date });

    const { body } = await sync(noa.session, [op]);
    expect(body.rejected).toEqual([]);
    expect(body.acked).toEqual([{ op_id: op.op_id }]);

    const [completion] = await db
      .select()
      .from(completions)
      .where(eq(completions.id, op.payload.completion_id));
    expect(completion!.choreDate).toBe(date);
    expect(completion!.instanceId).toBe(instanceId(choreId, noa.id, date));

    const [instance] = await db
      .select()
      .from(choreInstances)
      .where(eq(choreInstances.id, instanceId(choreId, noa.id, date)));
    expect(instance!.status).toBe('done');
    // Today's own instance was materialized by the pull and is untouched: the redo did not
    // become a completion of today's chore.
    const [todays] = await db
      .select()
      .from(choreInstances)
      .where(and(eq(choreInstances.childId, noa.id), eq(choreInstances.choreDate, today())));
    expect(todays!.status).toBe('due');

    // That past day is complete for the first time, so its bonus and its tree land on its date.
    expect(await balance(noa.id)).toBe(COINS_PER_CHORE + DAY_COMPLETE_BONUS);
    const trees = await db.select().from(growthEntries).where(eq(growthEntries.childId, noa.id));
    expect(trees.map((t) => t.id)).toEqual([growthId(noa.id, date)]);
  });

  it('refuses a three-day-old redo: it is outside the Redo Window', async () => {
    const { noa, choreId, date } = await pastRedo('user_redo_three', 3);
    const op = completeOp(choreId, { chore_date: date });

    const { body } = await sync(noa.session, [op]);
    expect(body.acked).toEqual([]);
    expect(body.rejected).toEqual([{ op_id: op.op_id, reason: 'too_late' }]);
    expect(await balance(noa.id)).toBe(0);

    const [instance] = await db
      .select()
      .from(choreInstances)
      .where(eq(choreInstances.id, instanceId(choreId, noa.id, date)));
    expect(instance!.status).toBe('redo');
  });

  it('accepts a long-offline device’s completion of a still-due day of its own', async () => {
    // Not a redo: the instance was never rejected, so the Redo Window has nothing to say about
    // it. Refusing this would have the device undo three days of honest work.
    const { noa, householdId, addChore } = await setup('user_offline_due');
    const choreId = await addChore('Dishes', [noa.id]);
    const date = addDays(today(), -3);
    await writeHouseholdInstances(db, householdId, date);
    const op = completeOp(choreId, { chore_date: date });

    const { body } = await sync(noa.session, [op]);
    expect(body.rejected).toEqual([]);
    expect(body.acked).toEqual([{ op_id: op.op_id }]);

    const [completion] = await db
      .select()
      .from(completions)
      .where(eq(completions.id, op.payload.completion_id));
    expect(completion!.choreDate).toBe(date);

    const [instance] = await db
      .select()
      .from(choreInstances)
      .where(eq(choreInstances.id, instanceId(choreId, noa.id, date)));
    expect(instance!.status).toBe('done');
    expect(await balance(noa.id)).toBe(COINS_PER_CHORE + DAY_COMPLETE_BONUS);
  });

  it('still adjusts a wrong-clock completion when no such instance exists', async () => {
    const { noa, addChore } = await setup('user_redo_no_instance');
    const choreId = await addChore('Dishes', [noa.id]);
    const claimed = addDays(today(), -5);
    const op = completeOp(choreId, { chore_date: claimed });

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
      .where(and(eq(choreInstances.childId, noa.id), eq(choreInstances.choreDate, claimed)));
    expect(stray).toEqual([]);
  });

  it('refuses the child’s undo of a redo completed today for an earlier date', async () => {
    const { noa, choreId, date } = await pastRedo('user_redo_undo', 2);
    const done = completeOp(choreId, { chore_date: date });
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
