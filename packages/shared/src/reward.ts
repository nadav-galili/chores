import { z } from 'zod';
import { uuid5 } from './uuid5.ts';

/**
 * The built-in reward catalog (docs/spec/01-product.md). A key, not a title: the row is copied
 * into every household at creation and the device renders its name from i18n, so the catalog is
 * never seeded in a language and a Hebrew parent and an English Kid Device each read their own.
 *
 * A key is a catalog constant and says nothing about a child, which is why it is the one thing
 * about a Redemption that may cross into analytics (ADR-0009).
 */
export const BUILTIN_REWARD_KEYS = ['snack', 'screen_time', 'friday_dinner'] as const;
export const builtinRewardKeySchema = z.enum(BUILTIN_REWARD_KEYS);
export type BuiltinRewardKey = z.infer<typeof builtinRewardKeySchema>;

export type BuiltinReward = {
  builtin_key: BuiltinRewardKey;
  cost_coins: number;
  icon: string;
  sort: number;
};

/** Costs are fixed and not parent-tunable, like every other coin value (ADR-0004). */
export const BUILTIN_REWARDS: readonly BuiltinReward[] = [
  { builtin_key: 'snack', cost_coins: 50, icon: '🍿', sort: 0 },
  { builtin_key: 'screen_time', cost_coins: 150, icon: '📺', sort: 1 },
  { builtin_key: 'friday_dinner', cost_coins: 400, icon: '🍕', sort: 2 },
];

/** A reward as it reaches a Kid Device. `title` is null for a built-in; i18n renders that one. */
export type Reward = {
  id: string;
  household_id: string;
  builtin_key: BuiltinRewardKey | null;
  title: string | null;
  icon: string | null;
  cost_coins: number;
  is_builtin: boolean;
  active: boolean;
  sort: number;
  updated_at: string;
  deleted_at: string | null;
};

/** The parent-authored fields on a custom catalog row. Built-in identity is never writable. */
export const customRewardInputSchema = z.object({
  title: z.string().trim().min(1).max(100),
  icon: z.string().trim().min(1).max(16).nullable(),
  cost_coins: z.number().int().positive().max(1_000_000),
  active: z.boolean(),
  sort: z.number().int().min(0).max(1_000_000),
  updated_at: z.string().datetime({ offset: true }),
});
export type CustomRewardInput = z.infer<typeof customRewardInputSchema>;

export const redemptionStatusSchema = z.enum(['requested', 'approved', 'declined', 'cancelled']);
export type RedemptionStatus = z.infer<typeof redemptionStatusSchema>;

/** Built-in reward id = uuid5('reward', household_id, builtin_key) (ADR-0010). */
export const builtinRewardId = (householdId: string, key: BuiltinRewardKey) =>
  uuid5('reward', householdId, key);

/**
 * The catalog as it is copied into one household. Ids are deterministic, so seeding twice — a
 * retried household creation, a backfill migration for a key added later — inserts each row once
 * under `ON CONFLICT DO NOTHING` rather than giving the household a second snack.
 */
export function builtinRewardsFor(householdId: string, updatedAt: string): Reward[] {
  return BUILTIN_REWARDS.map((r) => ({
    id: builtinRewardId(householdId, r.builtin_key),
    household_id: householdId,
    builtin_key: r.builtin_key,
    title: null,
    icon: r.icon,
    cost_coins: r.cost_coins,
    is_builtin: true,
    active: true,
    sort: r.sort,
    updated_at: updatedAt,
    deleted_at: null,
  }));
}
