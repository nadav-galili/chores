import {
  builtinRewardId,
  COINS_PER_CHORE,
  redeemEntryId,
  redemptionRefundId,
  uuid7,
  type DeviceSession,
} from '@chores/shared';
import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { createApp } from './app.ts';
import type { Db } from './db/client.ts';
import { ledgerEntries, redemptions, rewards, xpEvents } from './db/schema.ts';
import { fakeVerifyToken } from './test/auth.ts';
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
