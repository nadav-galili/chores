import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { redeemEntryId, redemptionRefundId, uuid7, xpId } from '@chores/shared';
import { openTestDb } from '@/db/test-db';
import type { DeviceDb } from '@/db/types';
import { ledgerEntries, outbox, redemptions, rewards, xpEvents } from '@/db/schema';
import { balanceOf, tapContext, type ChildContext } from './local';
import { askForReward, cancelRedemption } from './redeem';

let db: DeviceDb;
const childId = uuid7();
const householdId = uuid7();
const deviceId = uuid7();
const T = '2026-09-09T10:00:00.000Z';
const NOW = new Date(T);

const child: ChildContext = {
  householdId,
  childId,
  deviceId,
  tz: 'Asia/Jerusalem',
  dayBoundaryHour: 0,
};
const ctx = () => tapContext(child, NOW);

/** One catalog row, as a pull would have written it. */
async function seedReward(cost_coins = 50) {
  const id = uuid7();
  await db.insert(rewards).values({
    id,
    household_id: householdId,
    builtin_key: 'snack',
    title: null,
    icon: '🍿',
    cost_coins,
    is_builtin: true,
    active: true,
    sort: 0,
    updated_at: T,
    deleted_at: null,
  });
  return { id, cost_coins };
}

/** Coins this child has, as an earlier sync would have left them. */
async function seedCoins(coins: number) {
  await db.insert(ledgerEntries).values({
    id: uuid7(),
    household_id: householdId,
    child_id: childId,
    kind: 'earn',
    coins,
    money_amount: null,
    ref_type: 'completion',
    ref_id: uuid7(),
    created_at: T,
    created_by: childId,
  });
}

beforeEach(async () => {
  db = await openTestDb();
});

describe('askForReward', () => {
  it('writes the redemption, the redeem entry and the op in one transaction', async () => {
    const reward = await seedReward();
    await seedCoins(120);

    const result = await askForReward(db, ctx(), reward);
    expect(result).toEqual({ ok: true, redemption_id: expect.any(String) });
    const redemption_id = result.ok ? result.redemption_id : '';

    const [row] = await db.select().from(redemptions);
    expect(row).toMatchObject({
      id: redemption_id,
      reward_id: reward.id,
      child_id: childId,
      household_id: householdId,
      cost_coins: 50,
      status: 'requested',
      requested_at: T,
      decided_at: null,
      decided_by: null,
    });

    const [entry] = await db
      .select()
      .from(ledgerEntries)
      .where(eq(ledgerEntries.id, redeemEntryId(redemption_id)));
    expect(entry).toMatchObject({
      kind: 'redeem',
      coins: -50,
      ref_type: 'redemption',
      ref_id: redemption_id,
      child_id: childId,
    });

    const [op] = await db.select().from(outbox);
    expect(op).toMatchObject({ type: 'request_redemption', status: 'pending', attempts: 0 });
    expect(op!.payload).toEqual({
      redemption_id,
      reward_id: reward.id,
      requested_at: T,
    });
  });

  it('takes the coins immediately, with nothing held aside', async () => {
    const reward = await seedReward(150);
    await seedCoins(150);
    await askForReward(db, ctx(), reward);
    expect(await balanceOf(db, childId)).toBe(0);
  });

  it('costs the pet nothing: no xp mirrors the coins leaving', async () => {
    const reward = await seedReward();
    await seedCoins(120);
    const result = await askForReward(db, ctx(), reward);
    const id = result.ok ? result.redemption_id : '';
    expect(
      await db
        .select()
        .from(xpEvents)
        .where(eq(xpEvents.id, xpId(redeemEntryId(id)))),
    ).toEqual([]);
    expect(await db.select().from(xpEvents)).toEqual([]);
  });

  it('refuses what the balance does not cover, and writes none of the three rows', async () => {
    const reward = await seedReward(400);
    await seedCoins(399);

    expect(await askForReward(db, ctx(), reward)).toEqual({
      ok: false,
      reason: 'insufficient_coins',
    });
    expect(await db.select().from(redemptions)).toEqual([]);
    expect(await db.select().from(outbox)).toEqual([]);
    expect(await balanceOf(db, childId)).toBe(399);
  });

  it('refuses the second of two requests the coins only cover once', async () => {
    const reward = await seedReward(150);
    await seedCoins(200);

    expect((await askForReward(db, ctx(), reward)).ok).toBe(true);
    expect(await askForReward(db, ctx(), reward)).toEqual({
      ok: false,
      reason: 'insufficient_coins',
    });
    expect(await balanceOf(db, childId)).toBe(50);
  });
});

describe('cancelRedemption', () => {
  const request = async (cost = 50) => {
    const reward = await seedReward(cost);
    await seedCoins(cost + 20);
    const result = await askForReward(db, ctx(), reward);
    return result.ok ? result.redemption_id : '';
  };

  it('refunds through the clawback of the redeem entry and enqueues the op', async () => {
    const id = await request();
    expect(await cancelRedemption(db, ctx(), id)).toBe(true);

    const [row] = await db.select().from(redemptions).where(eq(redemptions.id, id));
    expect(row).toMatchObject({ status: 'cancelled', decided_at: T });

    const [refund] = await db
      .select()
      .from(ledgerEntries)
      .where(eq(ledgerEntries.id, redemptionRefundId(id)));
    expect(refund).toMatchObject({
      kind: 'clawback',
      coins: 50,
      ref_type: 'ledger_entry',
      ref_id: redeemEntryId(id),
    });
    expect(await balanceOf(db, childId)).toBe(70);

    const ops = await db.select().from(outbox);
    expect(ops.map((o) => o.type)).toEqual(['request_redemption', 'cancel_redemption']);
    expect(ops[1]!.payload).toEqual({ redemption_id: id });
  });

  it('cancelling twice refunds once', async () => {
    const id = await request();
    await cancelRedemption(db, ctx(), id);
    expect(await cancelRedemption(db, ctx(), id)).toBe(false);
    expect(await balanceOf(db, childId)).toBe(70);
    expect(await db.select().from(ledgerEntries)).toHaveLength(3);
  });

  it('does nothing to a request a parent has already decided', async () => {
    const id = await request();
    // The decision arrived as a pull: the parent approved it.
    await db
      .update(redemptions)
      .set({ status: 'approved', decided_at: T })
      .where(eq(redemptions.id, id));

    expect(await cancelRedemption(db, ctx(), id)).toBe(false);
    expect(await balanceOf(db, childId)).toBe(20);
    expect(
      await db
        .select()
        .from(ledgerEntries)
        .where(eq(ledgerEntries.id, redemptionRefundId(id))),
    ).toEqual([]);
    expect((await db.select().from(outbox)).map((o) => o.type)).toEqual(['request_redemption']);
  });

  it('does nothing for a redemption this device has never seen', async () => {
    expect(await cancelRedemption(db, ctx(), uuid7())).toBe(false);
    expect(await db.select().from(outbox)).toEqual([]);
  });
});
