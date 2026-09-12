import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { builtinRewardsFor, uuid7, type BuiltinRewardKey } from '@chores/shared';
import { openTestDb } from '@/db/test-db';
import type { DeviceDb } from '@/db/types';
import { ledgerEntries, redemptions, rewards } from '@/db/schema';
import { tapContext, type ChildContext } from './local';
import { askForReward, cancelRedemption } from './redeem';
import { showShop } from './shop';

let db: DeviceDb;
const childId = uuid7();
const siblingId = uuid7();
const householdId = uuid7();
const T = '2026-09-09T10:00:00.000Z';

const child: ChildContext = {
  householdId,
  childId,
  deviceId: uuid7(),
  tz: 'Asia/Jerusalem',
  dayBoundaryHour: 0,
};
const ctx = (now = T) => tapContext(child, new Date(now));

/** The household's catalog, as the pull that followed its creation would have written it. */
async function seedCatalog() {
  await db.insert(rewards).values(builtinRewardsFor(householdId, T));
}

const rewardId = async (key: BuiltinRewardKey) => {
  const [row] = await db.select().from(rewards).where(eq(rewards.builtin_key, key));
  return { id: row!.id, cost_coins: row!.cost_coins };
};

/** Coins this child has, as an earlier sync would have left them. */
async function seedCoins(coins: number, forChild = childId) {
  await db.insert(ledgerEntries).values({
    id: uuid7(),
    household_id: householdId,
    child_id: forChild,
    kind: 'earn',
    coins,
    money_amount: null,
    ref_type: 'completion',
    ref_id: uuid7(),
    created_at: T,
    created_by: forChild,
  });
}

beforeEach(async () => {
  db = await openTestDb();
});

describe('the catalog', () => {
  it('is the household’s active rewards, in the order a parent arranged them', async () => {
    await seedCatalog();
    const shop = await showShop(db, childId);
    expect(shop.rewards.map((r) => r.builtin_key)).toEqual([
      'snack',
      'screen_time',
      'friday_dinner',
    ]);
    expect(shop.rewards[0]).toMatchObject({ cost_coins: 50, icon: '🍿', title: null });
  });

  it('renders no title of its own for a built-in: the key is what the screen translates', async () => {
    await seedCatalog();
    const shop = await showShop(db, childId);
    for (const reward of shop.rewards) expect(reward.builtin_key).not.toBeNull();
  });

  it('drops a built-in a parent hid, rather than leaving it on the shelf', async () => {
    await seedCatalog();
    await db.update(rewards).set({ active: false }).where(eq(rewards.builtin_key, 'snack'));
    const shop = await showShop(db, childId);
    expect(shop.rewards.map((r) => r.builtin_key)).toEqual(['screen_time', 'friday_dinner']);
  });

  it('drops a deleted row too', async () => {
    await seedCatalog();
    await db.update(rewards).set({ deleted_at: T }).where(eq(rewards.builtin_key, 'snack'));
    expect((await showShop(db, childId)).rewards.map((r) => r.builtin_key)).toEqual([
      'screen_time',
      'friday_dinner',
    ]);
  });
});

describe('what the balance covers', () => {
  it('marks exactly what the coins reach, and the price itself is enough', async () => {
    await seedCatalog();
    await seedCoins(150);
    const shop = await showShop(db, childId);
    expect(shop.coins).toBe(150);
    expect(shop.rewards.map((r) => r.affordable)).toEqual([true, true, false]);
  });

  it('is the sum of this child’s ledger and no sibling’s', async () => {
    await seedCatalog();
    await seedCoins(40);
    await seedCoins(1000, siblingId);
    const shop = await showShop(db, childId);
    expect(shop.coins).toBe(40);
    expect(shop.rewards.every((r) => !r.affordable)).toBe(true);
  });

  it('falls the moment the child asks, so the next reward is out of reach at once', async () => {
    await seedCatalog();
    await seedCoins(200);
    await askForReward(db, ctx(), await rewardId('screen_time'));

    const shop = await showShop(db, childId);
    expect(shop.coins).toBe(50);
    expect(shop.rewards.map((r) => r.affordable)).toEqual([true, false, false]);
  });
});

describe('what the child has asked for', () => {
  it('shows a waiting request with the price it actually paid', async () => {
    await seedCatalog();
    await seedCoins(200);
    const reward = await rewardId('screen_time');
    const asked = await askForReward(db, ctx(), reward);

    const shop = await showShop(db, childId);
    expect(shop.requests).toHaveLength(1);
    expect(shop.requests[0]).toMatchObject({
      id: asked.ok ? asked.redemption_id : '',
      reward_id: reward.id,
      builtin_key: 'screen_time',
      icon: '📺',
      cost_coins: 150,
      status: 'requested',
      requested_at: T,
    });
  });

  it('quotes the snapshot on the request, not what the catalog costs today', async () => {
    await seedCatalog();
    await seedCoins(200);
    await askForReward(db, ctx(), await rewardId('screen_time'));
    await db.update(rewards).set({ cost_coins: 999 }).where(eq(rewards.builtin_key, 'screen_time'));

    expect((await showShop(db, childId)).requests[0]!.cost_coins).toBe(150);
  });

  it('drops one the child cancelled: they are the one who did it', async () => {
    await seedCatalog();
    await seedCoins(200);
    const asked = await askForReward(db, ctx(), await rewardId('snack'));
    await cancelRedemption(db, ctx(), asked.ok ? asked.redemption_id : '');

    const shop = await showShop(db, childId);
    expect(shop.requests).toEqual([]);
    expect(shop.coins).toBe(200);
  });

  it('shows a decision once it has been pulled, waiting first and then the answers', async () => {
    await seedCatalog();
    await seedCoins(600);
    const first = await askForReward(db, ctx('2026-09-09T08:00:00.000Z'), await rewardId('snack'));
    const second = await askForReward(
      db,
      ctx('2026-09-09T09:00:00.000Z'),
      await rewardId('screen_time'),
    );
    await askForReward(db, ctx('2026-09-09T07:00:00.000Z'), await rewardId('friday_dinner'));
    // The parent decided the two older ones; the pull rewrote their rows.
    await db
      .update(redemptions)
      .set({ status: 'approved', decided_at: T })
      .where(eq(redemptions.id, first.ok ? first.redemption_id : ''));
    await db
      .update(redemptions)
      .set({ status: 'declined', decided_at: T })
      .where(eq(redemptions.id, second.ok ? second.redemption_id : ''));

    const shop = await showShop(db, childId);
    expect(shop.requests.map((r) => [r.builtin_key, r.status])).toEqual([
      ['friday_dinner', 'requested'],
      ['screen_time', 'declined'],
      ['snack', 'approved'],
    ]);
  });

  it('stops after a few decisions, so the shop never becomes a record of refusals', async () => {
    await seedCatalog();
    await seedCoins(1000);
    for (let i = 0; i < 5; i += 1) {
      const asked = await askForReward(db, ctx(`2026-09-0${i + 1}T08:00:00.000Z`), {
        id: (await rewardId('snack')).id,
        cost_coins: 50,
      });
      await db
        .update(redemptions)
        .set({ status: 'declined', decided_at: T })
        .where(eq(redemptions.id, asked.ok ? asked.redemption_id : ''));
    }

    const shop = await showShop(db, childId);
    expect(shop.requests).toHaveLength(3);
    expect(shop.requests.map((r) => r.requested_at)).toEqual([
      '2026-09-05T08:00:00.000Z',
      '2026-09-04T08:00:00.000Z',
      '2026-09-03T08:00:00.000Z',
    ]);
  });

  it('is this child’s alone, never a sibling’s', async () => {
    await seedCatalog();
    await seedCoins(200);
    const reward = await rewardId('snack');
    await db.insert(redemptions).values({
      id: uuid7(),
      reward_id: reward.id,
      child_id: siblingId,
      household_id: householdId,
      cost_coins: 50,
      status: 'requested',
      requested_at: T,
      decided_at: null,
      decided_by: null,
    });

    expect((await showShop(db, childId)).requests).toEqual([]);
  });
});

describe('a device with nothing pulled yet', () => {
  it('is an empty shop rather than a failure', async () => {
    expect(await showShop(db, childId)).toEqual({ coins: 0, rewards: [], requests: [] });
  });
});
