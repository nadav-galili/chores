import { beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import {
  bonusId,
  clawbackId,
  COINS_PER_CHORE,
  DAY_COMPLETE_BONUS,
  earnId,
  growthId,
  instanceId,
  uuid7,
  type DeviceSession,
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
import { completeOp, setupHousehold, syncAs, testToday } from './test/household.ts';

let db: Db;
let app: ReturnType<typeof createApp>;

beforeAll(async () => {
  db = await freshDb();
  app = createApp(db, { verifyToken: fakeVerifyToken, redeemLimit: { max: 1000, windowMs: 1000 } });
});

const today = testToday;

const sync = (session: DeviceSession, ops: unknown[] = [], cursor = 0) =>
  syncAs(app, session, ops, cursor);

const reject = (clerkUserId: string, householdId: string, completionId: string) =>
  app.request(
    `/households/${householdId}/completions/${completionId}/reject`,
    asParent(clerkUserId, { method: 'POST' }),
  );

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

/** A household where Noa has completed her only chore, so the day is complete and paid. */
async function completed(clerkUserId: string) {
  const home = await setupHousehold(app, clerkUserId);
  const choreId = await home.addChore('Dishes', [home.noa.id]);
  const op = completeOp(choreId);
  const { body } = await sync(home.noa.session, [op]);
  expect(body.acked).toEqual([{ op_id: op.op_id }]);
  expect(await balance(home.noa.id)).toBe(COINS_PER_CHORE + DAY_COMPLETE_BONUS);
  return { ...home, choreId, completionId: op.payload.completion_id, cursor: body.cursor };
}

describe('POST /households/:id/completions/:id/reject', () => {
  it('claws back the earn and the bonus it triggered, and returns the instance as a redo', async () => {
    const { householdId, noa, choreId, completionId } = await completed('user_reject');

    const res = await reject('user_reject', householdId, completionId);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'rejected' });

    const [completion] = await db
      .select()
      .from(completions)
      .where(eq(completions.id, completionId));
    expect(completion).toMatchObject({ status: 'rejected' });
    expect(completion!.rejectedBy).not.toBeNull();
    expect(completion!.rejectedAt).not.toBeNull();

    const [instance] = await db
      .select()
      .from(choreInstances)
      .where(eq(choreInstances.id, instanceId(choreId, noa.id, today())));
    expect(instance!.status).toBe('redo');

    // Earn → reject nets to zero, bonus included, through clawbacks with deterministic ids.
    expect(await balance(noa.id)).toBe(0);
    expect(await xpTotal(noa.id)).toBe(0);
    const entries = await db
      .select()
      .from(ledgerEntries)
      .where(and(eq(ledgerEntries.childId, noa.id), eq(ledgerEntries.kind, 'clawback')));
    expect(entries.map((e) => [e.id, e.coins]).sort()).toEqual(
      [
        [clawbackId(earnId(completionId)), -COINS_PER_CHORE],
        [clawbackId(bonusId(noa.id, today())), -DAY_COMPLETE_BONUS],
      ].sort(),
    );

    const [summary] = await db
      .select()
      .from(daySummaries)
      .where(and(eq(daySummaries.childId, noa.id), eq(daySummaries.choreDate, today())));
    expect(summary).toMatchObject({ dueCount: 1, doneCount: 0, complete: false, streakAfter: 0 });

    // The rejection costs coins and the streak, never a tree (ADR-0011).
    const trees = await db.select().from(growthEntries).where(eq(growthEntries.childId, noa.id));
    expect(trees.map((t) => t.id)).toEqual([growthId(noa.id, today())]);
  });

  it('produces one clawback when both parents reject the same completion', async () => {
    const { householdId, noa, completionId } = await completed('user_reject_both_at_example.com');
    // The partner joins by email and signs in for the first time.
    await app.request(
      `/households/${householdId}/parents`,
      asParent('user_reject_both_at_example.com', {
        method: 'POST',
        body: JSON.stringify({ email: 'dana@example.com' }),
      }),
    );
    await app.request('/me', asParent('user_dana_at_example.com'));

    const [first, second] = await Promise.all([
      reject('user_reject_both_at_example.com', householdId, completionId),
      reject('user_dana_at_example.com', householdId, completionId),
    ]);
    expect([first.status, second.status]).toEqual([200, 200]);
    expect(await first.json()).toEqual({ status: 'rejected' });
    expect(await second.json()).toEqual({ status: 'rejected' });

    const clawbacks = await db
      .select()
      .from(ledgerEntries)
      .where(and(eq(ledgerEntries.childId, noa.id), eq(ledgerEntries.kind, 'clawback')));
    expect(clawbacks.filter((e) => e.refId === earnId(completionId))).toHaveLength(1);
    expect(await balance(noa.id)).toBe(0);
  });

  it('answers already_undone and moves nothing when the child undid the tap first', async () => {
    const { householdId, noa, choreId, completionId, cursor } = await completed('user_reject_late');
    await sync(
      noa.session,
      [{ op_id: uuid7(), type: 'uncomplete', payload: { completion_id: completionId } }],
      cursor,
    );
    expect(await balance(noa.id)).toBe(0);

    const res = await reject('user_reject_late', householdId, completionId);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'already_undone' });

    const [completion] = await db
      .select()
      .from(completions)
      .where(eq(completions.id, completionId));
    expect(completion).toMatchObject({ status: 'undone', rejectedBy: null, rejectedAt: null });
    // The child's own undo left the instance due, not as a redo.
    const [instance] = await db
      .select()
      .from(choreInstances)
      .where(eq(choreInstances.id, instanceId(choreId, noa.id, today())));
    expect(instance!.status).toBe('due');
    expect(await balance(noa.id)).toBe(0);
  });

  it('does not reach another household’s completion', async () => {
    const mine = await completed('user_reject_mine');
    const theirs = await completed('user_reject_theirs');

    const res = await reject('user_reject_mine', mine.householdId, theirs.completionId);
    expect(res.status).toBe(404);
    const [completion] = await db
      .select()
      .from(completions)
      .where(eq(completions.id, theirs.completionId));
    expect(completion!.status).toBe('accepted');
    expect(await balance(theirs.noa.id)).toBe(COINS_PER_CHORE + DAY_COMPLETE_BONUS);
  });

  it('lets the child redo the chore, which pays again through a new completion', async () => {
    const { householdId, noa, choreId, completionId, cursor } = await completed('user_reject_redo');
    await reject('user_reject_redo', householdId, completionId);

    const redo = completeOp(choreId);
    const { body } = await sync(noa.session, [redo], cursor);
    expect(body.acked).toEqual([{ op_id: redo.op_id }]);

    const [instance] = await db
      .select()
      .from(choreInstances)
      .where(eq(choreInstances.id, instanceId(choreId, noa.id, today())));
    expect(instance!.status).toBe('done');
    expect(await balance(noa.id)).toBe(COINS_PER_CHORE + DAY_COMPLETE_BONUS);
  });

  it('leaves the instance done when another completion of it is still accepted', async () => {
    const { householdId, noa, choreId, completionId, cursor } =
      await completed('user_reject_stale');
    // A second tap of the same instance — a child with two devices, both offline — lands as its
    // own completion row; the instance is done twice over.
    const again = completeOp(choreId);
    await sync(noa.session, [again], cursor);
    const instanceKey = instanceId(choreId, noa.id, today());

    const res = await reject('user_reject_stale', householdId, completionId);
    expect(await res.json()).toEqual({ status: 'rejected' });

    // The rejected completion stops paying, but the accepted one still holds the instance up:
    // telling the child to redo work that is done would be wrong.
    const [instance] = await db
      .select()
      .from(choreInstances)
      .where(eq(choreInstances.id, instanceKey));
    expect(instance!.status).toBe('done');
    const [summary] = await db
      .select()
      .from(daySummaries)
      .where(and(eq(daySummaries.childId, noa.id), eq(daySummaries.choreDate, today())));
    expect(summary).toMatchObject({ doneCount: 1, complete: true });
  });

  it('sends the rejection to the kid device as changes it can apply', async () => {
    const { householdId, noa, choreId, completionId, cursor } = await completed('user_reject_pull');
    await reject('user_reject_pull', householdId, completionId);

    const { body } = await sync(noa.session, [], cursor);
    const completion = body.changes.find(
      (c) => c.table === 'completions' && c.row_id === completionId,
    );
    expect(completion!.row).toMatchObject({ status: 'rejected' });
    const instance = body.changes.find(
      (c) => c.table === 'chore_instances' && c.row_id === instanceId(choreId, noa.id, today()),
    );
    expect(instance!.row).toMatchObject({ status: 'redo' });
    const clawbacks = body.changes.filter(
      (c) => c.table === 'ledger_entries' && c.row.kind === 'clawback',
    );
    expect(clawbacks.map((c) => c.row.coins).sort()).toEqual(
      [-COINS_PER_CHORE, -DAY_COMPLETE_BONUS].sort(),
    );
  });
});
