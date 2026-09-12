import type { BuiltinRewardKey, RedemptionStatus } from '@chores/shared';
import { asc, eq, isNull } from 'drizzle-orm';
import { redemptions, rewards } from '@/db/schema';
import type { DeviceDb } from '@/db/types';
import { balanceOf } from './local';

/**
 * The reward shop as the child's device knows it: the household's catalog, what the balance
 * covers, and what this child has already asked for. Local rows only, so the shop opens and
 * spends with no network (ADR-0014) — the coins left the ledger when they asked.
 *
 * Hiding a built-in is `active = false` on the household's own row, and an inactive row still
 * reaches the device (docs/spec/03-sync.md), which is what makes it disappear from here rather
 * than linger. Titles are not resolved here at all: a built-in carries a `builtin_key` and no
 * title, and the screen renders its name from i18n in the language the device is set to.
 */

/** One catalog row, priced against what the child has. */
export type ShopReward = {
  id: string;
  builtin_key: BuiltinRewardKey | null;
  title: string | null;
  icon: string | null;
  cost_coins: number;
  /**
   * The local balance covers it. The server asks the same question again when the op arrives —
   * a parent's Rejection can have taken coins this device has not pulled — so this is what keeps
   * a child from being disappointed by a decision they could not have made, not the rule itself.
   */
  affordable: boolean;
};

/** One thing this child asked for, with the reward it names resolved for the screen. */
export type ShopRequest = {
  id: string;
  reward_id: string;
  builtin_key: BuiltinRewardKey | null;
  title: string | null;
  icon: string | null;
  cost_coins: number;
  status: RedemptionStatus;
  requested_at: string;
};

export type ShopView = {
  /** Balance, always `SUM(coins)` over the local ledger. */
  coins: number;
  /** Active rewards, in the order a parent arranged them. */
  rewards: ShopReward[];
  /** Everything still waiting, then the few most recent decisions. */
  requests: ShopRequest[];
};

/**
 * How many decided requests stay on screen. A request that has been answered is news exactly
 * once; a list of every yes and no this child has ever had would turn the shop into a record of
 * refusals, which is the one thing it must not be.
 */
const DECISIONS_SHOWN = 3;

/** The shop to draw for `childId`. Reads local rows and nothing else. */
export async function showShop(db: DeviceDb, childId: string): Promise<ShopView> {
  const [coins, catalog, asked] = await Promise.all([
    balanceOf(db, childId),
    db
      .select()
      .from(rewards)
      .where(isNull(rewards.deleted_at))
      .orderBy(asc(rewards.sort), asc(rewards.id)),
    db.select().from(redemptions).where(eq(redemptions.child_id, childId)),
  ]);

  const byId = new Map(catalog.map((row) => [row.id, row]));

  const requests = asked
    .map((row): ShopRequest => {
      const reward = byId.get(row.reward_id);
      return {
        id: row.id,
        reward_id: row.reward_id,
        builtin_key: reward?.builtin_key ?? null,
        title: reward?.title ?? null,
        icon: reward?.icon ?? null,
        // The snapshot on the redemption, never the catalog's price today: what the coins that
        // left actually paid.
        cost_coins: row.cost_coins,
        status: row.status,
        requested_at: row.requested_at,
      };
    })
    // Newest first; uuid7 ids break a tie between two requests made in the same millisecond.
    .sort((a, b) => b.requested_at.localeCompare(a.requested_at) || b.id.localeCompare(a.id));

  return {
    coins,
    rewards: catalog
      .filter((row) => row.active)
      .map((row) => ({
        id: row.id,
        builtin_key: row.builtin_key,
        title: row.title,
        icon: row.icon,
        cost_coins: row.cost_coins,
        affordable: coins >= row.cost_coins,
      })),
    requests: [
      ...requests.filter((r) => r.status === 'requested'),
      // A request the child cancelled themselves is not news: they are the one who did it.
      ...requests
        .filter((r) => r.status === 'approved' || r.status === 'declined')
        .slice(0, DECISIONS_SHOWN),
    ],
  };
}
