import {
  builtinRewardId,
  COINS_PER_CHORE,
  redeemEntryId,
  redemptionRefundId,
  uuid7,
  type DeviceSession,
  type ParentToday,
} from '@chores/shared';
import { eq } from 'drizzle-orm';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { recordingAnalytics } from './analytics.ts';
import { createApp } from './app.ts';
import type { Db } from './db/client.ts';
import { ledgerEntries, redemptions, rewards, xpEvents } from './db/schema.ts';
import { asParent, fakeVerifyToken } from './test/auth.ts';
import { freshDb } from './test/db.ts';
import { completeOp, setupHousehold, syncAs } from './test/household.ts';

/**
 * The kid ops behind the reward shop (ADR-0014): the coins leave when the child asks, and a
 * cancel refunds them under the one id a decline would also use.
 */

let db: Db;
let app: ReturnType<typeof createApp>;

beforeAll(async () => {
  db = await freshDb();
  app = createApp(db, {
    verifyToken: fakeVerifyToken,
    redeemLimit: { max: 1000, windowMs: 60_000 },
  });
});

const sync = (session: DeviceSession, ops: unknown[] = [], cursor = 0) =>
  syncAs(app, session, ops, cursor);

const balance = async (childId: string) => {
  const rows = await db
    .select({ coins: ledgerEntries.coins })
    .from(ledgerEntries)
    .where(eq(ledgerEntries.childId, childId));
  return rows.reduce((sum, r) => sum + r.coins, 0);
};

const entriesOf = (childId: string) =>
  db.select().from(ledgerEntries).where(eq(ledgerEntries.childId, childId));

const requestOp = (rewardId: string, over: Record<string, unknown> = {}) => ({
  op_id: uuid7(),
  type: 'request_redemption',
  payload: {
    redemption_id: uuid7(),
    reward_id: rewardId,
    requested_at: new Date().toISOString(),
    ...over,
  },
});

const cancelOp = (redemptionId: string) => ({
  op_id: uuid7(),
  type: 'cancel_redemption',
  payload: { redemption_id: redemptionId },
});

/** Enough accepted completions to cover `coins`, each on its own chore. */
async function earn(
  fixture: Awaited<ReturnType<typeof setupHousehold>>,
  session: DeviceSession,
  childId: string,
  coins: number,
) {
  const ops = [];
  for (let i = 0; i < Math.ceil(coins / COINS_PER_CHORE); i++) {
    ops.push(completeOp(await fixture.addChore(`Chore ${i}`, [childId])));
  }
  await sync(session, ops);
}

describe('request_redemption', () => {
  it('writes the redemption and the redeem entry at −cost, and no xp', async () => {
    const fixture = await setupHousehold(app, 'user_redeem_ok');
    const { noa, householdId } = fixture;
    await earn(fixture, noa.session, noa.id, 60);
    const before = await balance(noa.id);

    const snack = builtinRewardId(householdId, 'snack');
    const op = requestOp(snack);
    const { body } = await sync(noa.session, [op]);
    expect(body.acked).toEqual([{ op_id: op.op_id }]);
    expect(body.rejected).toEqual([]);

    const [row] = await db
      .select()
      .from(redemptions)
      .where(eq(redemptions.id, op.payload.redemption_id));
    expect(row).toMatchObject({
      rewardId: snack,
      childId: noa.id,
      householdId,
      costCoins: 50,
      status: 'requested',
      decidedAt: null,
      decidedBy: null,
    });

    const [entry] = await db
      .select()
      .from(ledgerEntries)
      .where(eq(ledgerEntries.id, redeemEntryId(op.payload.redemption_id)));
    expect(entry).toMatchObject({
      kind: 'redeem',
      coins: -50,
      refType: 'redemption',
      refId: op.payload.redemption_id,
      childId: noa.id,
    });
    expect(await balance(noa.id)).toBe(before - 50);

    // Coins and pet XP are separate: spending coins never costs the pet its progress (ADR-0004).
    const xp = await db
      .select()
      .from(xpEvents)
      .where(eq(xpEvents.refEntryId, redeemEntryId(op.payload.redemption_id)));
    expect(xp).toEqual([]);
  });

  it('returns the rows it wrote in the same response', async () => {
    const fixture = await setupHousehold(app, 'user_redeem_changes');
    const { noa, householdId } = fixture;
    await earn(fixture, noa.session, noa.id, 60);
    const op = requestOp(builtinRewardId(householdId, 'snack'));
    const { body } = await sync(noa.session, [op]);
    const rows = body.changes.filter((c) => c.table === 'redemptions');
    expect(rows.map((c) => c.row.id)).toContain(op.payload.redemption_id);
  });

  it('replaying the same op changes nothing', async () => {
    const fixture = await setupHousehold(app, 'user_redeem_replay');
    const { noa, householdId } = fixture;
    await earn(fixture, noa.session, noa.id, 60);
    const op = requestOp(builtinRewardId(householdId, 'snack'));

    await sync(noa.session, [op]);
    const after = await balance(noa.id);
    const entries = await entriesOf(noa.id);

    const { body } = await sync(noa.session, [op, op]);
    expect(body.acked).toEqual([{ op_id: op.op_id }, { op_id: op.op_id }]);
    expect(body.rejected).toEqual([]);
    expect(await balance(noa.id)).toBe(after);
    expect(await entriesOf(noa.id)).toHaveLength(entries.length);
    expect(await db.select().from(redemptions).where(eq(redemptions.childId, noa.id))).toHaveLength(
      1,
    );
  });

  it('a second op naming a redemption that already exists writes nothing more', async () => {
    const fixture = await setupHousehold(app, 'user_redeem_same_id');
    const { noa, householdId } = fixture;
    await earn(fixture, noa.session, noa.id, 200);
    const first = requestOp(builtinRewardId(householdId, 'snack'));
    await sync(noa.session, [first]);
    const after = await balance(noa.id);

    const again = requestOp(builtinRewardId(householdId, 'snack'), {
      redemption_id: first.payload.redemption_id,
    });
    const { body } = await sync(noa.session, [again]);
    expect(body.rejected).toEqual([]);
    expect(await balance(noa.id)).toBe(after);
  });

  it('refuses insufficient_coins and writes nothing at all', async () => {
    const fixture = await setupHousehold(app, 'user_redeem_broke');
    const { noa, householdId } = fixture;
    await earn(fixture, noa.session, noa.id, 30);
    const before = await balance(noa.id);
    expect(before).toBeLessThan(400);

    const op = requestOp(builtinRewardId(householdId, 'friday_dinner'));
    const { body } = await sync(noa.session, [op]);
    expect(body.rejected).toEqual([{ op_id: op.op_id, reason: 'insufficient_coins' }]);
    expect(body.acked).toEqual([]);
    expect(await balance(noa.id)).toBe(before);
    expect(
      await db.select().from(redemptions).where(eq(redemptions.id, op.payload.redemption_id)),
    ).toEqual([]);
    expect(
      await db
        .select()
        .from(ledgerEntries)
        .where(eq(ledgerEntries.id, redeemEntryId(op.payload.redemption_id))),
    ).toEqual([]);
  });

  it('refuses a second request the first one already spent the coins on', async () => {
    const fixture = await setupHousehold(app, 'user_redeem_twice');
    const { noa, householdId } = fixture;
    await earn(fixture, noa.session, noa.id, 60);
    const dinner = builtinRewardId(householdId, 'snack');
    const first = requestOp(dinner);
    const second = requestOp(dinner);

    const { body } = await sync(noa.session, [first, second]);
    expect(body.acked).toEqual([{ op_id: first.op_id }]);
    expect(body.rejected).toEqual([{ op_id: second.op_id, reason: 'insufficient_coins' }]);
  });

  it('refuses a reward of another household, and one a parent has hidden', async () => {
    const fixture = await setupHousehold(app, 'user_redeem_foreign');
    const theirs = await setupHousehold(app, 'user_redeem_other');
    const { noa, householdId } = fixture;
    await earn(fixture, noa.session, noa.id, 200);

    const foreign = requestOp(builtinRewardId(theirs.householdId, 'snack'));
    const hiddenId = builtinRewardId(householdId, 'screen_time');
    await db.update(rewards).set({ active: false }).where(eq(rewards.id, hiddenId));
    const hidden = requestOp(hiddenId);

    const { body } = await sync(noa.session, [foreign, hidden]);
    expect(body.rejected).toEqual([
      { op_id: foreign.op_id, reason: 'unknown_reward' },
      { op_id: hidden.op_id, reason: 'unknown_reward' },
    ]);
  });

  it('does not let one child spend another child’s coins', async () => {
    const fixture = await setupHousehold(app, 'user_redeem_sibling');
    const { noa, ori, householdId } = fixture;
    await earn(fixture, noa.session, noa.id, 200);
    const op = requestOp(builtinRewardId(householdId, 'snack'));

    // Ori has earned nothing; Noa's balance is not Ori's to spend.
    const { body } = await sync(ori.session, [op]);
    expect(body.rejected).toEqual([{ op_id: op.op_id, reason: 'insufficient_coins' }]);
  });
});

describe('cancel_redemption', () => {
  const setupRequested = async (user: string) => {
    const fixture = await setupHousehold(app, user);
    await earn(fixture, fixture.noa.session, fixture.noa.id, 200);
    const op = requestOp(builtinRewardId(fixture.householdId, 'snack'));
    await sync(fixture.noa.session, [op]);
    return { ...fixture, redemptionId: op.payload.redemption_id };
  };

  it('refunds through the clawback of the redeem entry and cancels the row', async () => {
    const { noa, redemptionId } = await setupRequested('user_cancel_ok');
    const spent = await balance(noa.id);

    const op = cancelOp(redemptionId);
    const { body } = await sync(noa.session, [op]);
    expect(body.acked).toEqual([{ op_id: op.op_id }]);

    const [row] = await db.select().from(redemptions).where(eq(redemptions.id, redemptionId));
    expect(row!.status).toBe('cancelled');
    expect(row!.decidedAt).not.toBeNull();

    const [refund] = await db
      .select()
      .from(ledgerEntries)
      .where(eq(ledgerEntries.id, redemptionRefundId(redemptionId)));
    expect(refund).toMatchObject({
      kind: 'clawback',
      coins: 50,
      refType: 'ledger_entry',
      refId: redeemEntryId(redemptionId),
    });
    expect(await balance(noa.id)).toBe(spent + 50);
  });

  it('cancelling twice refunds once', async () => {
    const { noa, redemptionId } = await setupRequested('user_cancel_twice');
    await sync(noa.session, [cancelOp(redemptionId)]);
    const refunded = await balance(noa.id);

    const { body } = await sync(noa.session, [cancelOp(redemptionId)]);
    expect(body.rejected).toEqual([]);
    expect(await balance(noa.id)).toBe(refunded);
    expect(
      (await entriesOf(noa.id)).filter((e) => e.id === redemptionRefundId(redemptionId)),
    ).toHaveLength(1);
  });

  it('answers already_decided against a decision, and moves no coins', async () => {
    const { noa, redemptionId } = await setupRequested('user_cancel_decided');
    // #45 builds the parent's screen; the decision it records is this row.
    await db
      .update(redemptions)
      .set({ status: 'approved', decidedAt: new Date() })
      .where(eq(redemptions.id, redemptionId));
    const spent = await balance(noa.id);

    const op = cancelOp(redemptionId);
    const { body } = await sync(noa.session, [op]);
    expect(body.rejected).toEqual([{ op_id: op.op_id, reason: 'already_decided' }]);
    expect(await balance(noa.id)).toBe(spent);
    expect(
      await db
        .select()
        .from(ledgerEntries)
        .where(eq(ledgerEntries.id, redemptionRefundId(redemptionId))),
    ).toEqual([]);
  });

  it('refuses a redemption that is not this child’s', async () => {
    const { ori, redemptionId } = await setupRequested('user_cancel_sibling');
    const op = cancelOp(redemptionId);
    const { body } = await sync(ori.session, [op]);
    expect(body.rejected).toEqual([{ op_id: op.op_id, reason: 'unknown_redemption' }]);
  });

  it('refuses a redemption nobody ever asked for', async () => {
    const { noa } = await setupRequested('user_cancel_unknown');
    const op = cancelOp(uuid7());
    const { body } = await sync(noa.session, [op]);
    expect(body.rejected).toEqual([{ op_id: op.op_id, reason: 'unknown_redemption' }]);
  });
});

describe('the balance a redemption leaves behind', () => {
  it('is SUM(coins) and survives reconciliation untouched', async () => {
    const fixture = await setupHousehold(app, 'user_redeem_reconcile');
    const { noa, householdId } = fixture;
    await earn(fixture, noa.session, noa.id, 200);
    const op = requestOp(builtinRewardId(householdId, 'screen_time'));
    await sync(noa.session, [op]);
    const spent = await balance(noa.id);

    // A later completion reconciles the whole child; the redeem entry is not its to reverse.
    await sync(noa.session, [completeOp(await fixture.addChore('Later', [noa.id]))]);
    expect(await balance(noa.id)).toBe(spent + COINS_PER_CHORE);
    expect(
      await db
        .select()
        .from(ledgerEntries)
        .where(eq(ledgerEntries.id, redemptionRefundId(op.payload.redemption_id))),
    ).toEqual([]);
  });
});

describe('a parent decides a redemption', () => {
  let parentApp: ReturnType<typeof createApp>;
  let analytics: ReturnType<typeof recordingAnalytics>;

  beforeEach(() => {
    analytics = recordingAnalytics();
    parentApp = createApp(db, {
      verifyToken: fakeVerifyToken,
      redeemLimit: { max: 1000, windowMs: 60_000 },
      analytics,
    });
  });

  /** A household whose Noa has asked for a snack and whose coins have already left. */
  const setupRequested = async (user: string) => {
    const fixture = await setupHousehold(parentApp, user);
    await earn(fixture, fixture.noa.session, fixture.noa.id, 200);
    const op = requestOp(builtinRewardId(fixture.householdId, 'snack'));
    await syncAs(parentApp, fixture.noa.session, [op]);
    return { ...fixture, user, redemptionId: op.payload.redemption_id };
  };

  const decide = (
    fixture: { householdId: string; user: string },
    redemptionId: string,
    decision: 'approve' | 'decline',
  ) =>
    parentApp.request(
      `/households/${fixture.householdId}/redemptions/${redemptionId}/decide`,
      asParent(fixture.user, { method: 'POST', body: JSON.stringify({ decision }) }),
    );

  const statusOf = async (res: Response) => ((await res.json()) as { status: string }).status;

  const refundsFor = (redemptionId: string) =>
    db
      .select()
      .from(ledgerEntries)
      .where(eq(ledgerEntries.id, redemptionRefundId(redemptionId)));

  const todayOf = async (fixture: { householdId: string; user: string }) => {
    const res = await parentApp.request(
      `/households/${fixture.householdId}/today`,
      asParent(fixture.user),
    );
    return (await res.json()) as ParentToday;
  };

  it('carries the household’s undecided redemptions on the parent today screen', async () => {
    const fixture = await setupRequested('user_decide_today');
    const today = await todayOf(fixture);
    expect(today.redemptions).toEqual([
      {
        redemption_id: fixture.redemptionId,
        child_id: fixture.noa.id,
        first_name: 'Noa',
        reward_id: builtinRewardId(fixture.householdId, 'snack'),
        builtin_key: 'snack',
        title: null,
        icon: '🍿',
        cost_coins: 50,
        requested_at: expect.any(String),
      },
    ]);

    // Decided is decided: the screen carries what is still waiting, and nothing else.
    await decide(fixture, fixture.redemptionId, 'approve');
    expect((await todayOf(fixture)).redemptions).toEqual([]);
  });

  it('approves without writing a ledger entry: the coins went when the child asked', async () => {
    const fixture = await setupRequested('user_decide_approve');
    const spent = await balance(fixture.noa.id);
    const before = await entriesOf(fixture.noa.id);

    expect(await statusOf(await decide(fixture, fixture.redemptionId, 'approve'))).toBe('approved');

    const [row] = await db
      .select()
      .from(redemptions)
      .where(eq(redemptions.id, fixture.redemptionId));
    expect(row!.status).toBe('approved');
    expect(row!.decidedBy).not.toBeNull();
    expect(await balance(fixture.noa.id)).toBe(spent);
    expect(await entriesOf(fixture.noa.id)).toHaveLength(before.length);
  });

  it('declines through the same clawback id a cancel would write', async () => {
    const fixture = await setupRequested('user_decide_decline');
    const spent = await balance(fixture.noa.id);

    expect(await statusOf(await decide(fixture, fixture.redemptionId, 'decline'))).toBe('declined');

    const [row] = await db
      .select()
      .from(redemptions)
      .where(eq(redemptions.id, fixture.redemptionId));
    expect(row!.status).toBe('declined');
    const refunds = await refundsFor(fixture.redemptionId);
    expect(refunds).toHaveLength(1);
    expect(refunds[0]).toMatchObject({
      kind: 'clawback',
      coins: 50,
      refType: 'ledger_entry',
      refId: redeemEntryId(fixture.redemptionId),
    });
    expect(await balance(fixture.noa.id)).toBe(spent + 50);
  });

  it('answers already_decided the second time, and moves nothing', async () => {
    const fixture = await setupRequested('user_decide_twice');
    await decide(fixture, fixture.redemptionId, 'decline');
    const refunded = await balance(fixture.noa.id);

    expect(await statusOf(await decide(fixture, fixture.redemptionId, 'approve'))).toBe(
      'already_decided',
    );
    expect(await balance(fixture.noa.id)).toBe(refunded);
    expect(await refundsFor(fixture.redemptionId)).toHaveLength(1);
  });

  it('answers already_cancelled when the child got there first, with one refund', async () => {
    const fixture = await setupRequested('user_decide_after_cancel');
    await syncAs(parentApp, fixture.noa.session, [cancelOp(fixture.redemptionId)]);
    const refunded = await balance(fixture.noa.id);

    expect(await statusOf(await decide(fixture, fixture.redemptionId, 'decline'))).toBe(
      'already_cancelled',
    );
    expect(await balance(fixture.noa.id)).toBe(refunded);
    expect(await refundsFor(fixture.redemptionId)).toHaveLength(1);
  });

  it('leaves a cancel nothing to refund once a parent has decided', async () => {
    const fixture = await setupRequested('user_cancel_after_decide');
    await decide(fixture, fixture.redemptionId, 'approve');
    const spent = await balance(fixture.noa.id);

    const op = cancelOp(fixture.redemptionId);
    const { body } = await syncAs(parentApp, fixture.noa.session, [op]);
    expect(body.rejected).toEqual([{ op_id: op.op_id, reason: 'already_decided' }]);
    expect(await balance(fixture.noa.id)).toBe(spent);
    expect(await refundsFor(fixture.redemptionId)).toEqual([]);
  });

  it('refunds once when a decline and a cancel race, whichever wins', async () => {
    const fixture = await setupRequested('user_decide_race');
    const spent = await balance(fixture.noa.id);

    const [decided, synced] = await Promise.all([
      decide(fixture, fixture.redemptionId, 'decline'),
      syncAs(parentApp, fixture.noa.session, [cancelOp(fixture.redemptionId)]),
    ]);
    const status = await statusOf(decided);

    // Whoever lost says so; the ledger cannot tell the difference, because both refunds are the
    // one row under `uuid5('clawback', redeem_entry_id)` (ADR-0014).
    expect(['declined', 'already_cancelled']).toContain(status);
    expect(synced.body.rejected.length + synced.body.acked.length).toBe(1);
    expect(await refundsFor(fixture.redemptionId)).toHaveLength(1);
    expect(await balance(fixture.noa.id)).toBe(spent + 50);
  });

  it('refunds not at all when an approval and a cancel race, whichever wins', async () => {
    const fixture = await setupRequested('user_approve_race');
    const spent = await balance(fixture.noa.id);

    const [decided, synced] = await Promise.all([
      decide(fixture, fixture.redemptionId, 'approve'),
      syncAs(parentApp, fixture.noa.session, [cancelOp(fixture.redemptionId)]),
    ]);
    const status = await statusOf(decided);
    const refunds = await refundsFor(fixture.redemptionId);

    if (status === 'approved') {
      // The parent won: the cancel is `already_decided` and the coins stay spent.
      expect(synced.body.rejected).toEqual([
        { op_id: expect.any(String), reason: 'already_decided' },
      ]);
      expect(refunds).toEqual([]);
      expect(await balance(fixture.noa.id)).toBe(spent);
    } else {
      expect(status).toBe('already_cancelled');
      expect(refunds).toHaveLength(1);
      expect(await balance(fixture.noa.id)).toBe(spent + 50);
    }
  });

  it('is parent-scoped: another household’s parent cannot decide it', async () => {
    const fixture = await setupRequested('user_decide_scope');
    const other = await setupHousehold(parentApp, 'user_decide_outsider');
    const res = await parentApp.request(
      `/households/${other.householdId}/redemptions/${fixture.redemptionId}/decide`,
      asParent('user_decide_outsider', {
        method: 'POST',
        body: JSON.stringify({ decision: 'approve' }),
      }),
    );
    expect(res.status).toBe(404);
    const [row] = await db
      .select()
      .from(redemptions)
      .where(eq(redemptions.id, fixture.redemptionId));
    expect(row!.status).toBe('requested');
  });

  it('reports the decision under the parent, grouped by the household', async () => {
    const fixture = await setupRequested('user_decide_analytics');
    await decide(fixture, fixture.redemptionId, 'decline');
    expect(analytics.sent.filter((s) => s.event.event === 'redemption_decided')).toEqual([
      {
        distinctId: 'user_decide_analytics',
        event: { event: 'redemption_decided', properties: { decision: 'declined' } },
        groups: { household: fixture.householdId },
      },
    ]);

    // A decision that decided nothing is not a decision.
    await decide(fixture, fixture.redemptionId, 'approve');
    expect(analytics.sent.filter((s) => s.event.event === 'redemption_decided')).toHaveLength(1);
  });
});
