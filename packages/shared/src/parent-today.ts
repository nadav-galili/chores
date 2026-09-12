import { z } from 'zod';
import type { IsoDate } from './chore-date.ts';
import { instanceStatusSchema } from './materialize.ts';
import { builtinRewardKeySchema } from './reward.ts';

/** One instance on the parent's today screen: what it is, and when it was done. */
export const parentTodayItemSchema = z.object({
  instance_id: z.string().uuid(),
  chore_id: z.string().uuid(),
  title: z.string(),
  icon: z.string().nullable(),
  status: instanceStatusSchema,
  /** The accepted completion's instant — or the photo-taken instant while it still waits on a parent — or null while the instance is still due. */
  completed_at: z.string().datetime().nullable(),
  /**
   * The accepted completion's id — or the waiting photo's, so a parent can open it and
   * approve or decline — or null while the instance is still due. It is the only thing
   * on a parent surface that can name a completion, so it is what makes a rejection reachable.
   */
  completion_id: z.string().uuid().nullable(),
});
export type ParentTodayItem = z.infer<typeof parentTodayItemSchema>;

export const parentTodayChildSchema = z.object({
  child_id: z.string().uuid(),
  first_name: z.string(),
  items: z.array(parentTodayItemSchema),
  due_count: z.number().int(),
  done_count: z.number().int(),
  /** The child's balance: always `SUM(coins)` of their whole ledger, never a stored column. */
  balance: z.number().int(),
  streak: z.number().int(),
});
export type ParentTodayChild = z.infer<typeof parentTodayChildSchema>;

/**
 * A Redemption nobody has decided yet: who asked, for what, and what it already cost them. The
 * coins left the ledger when the child asked (ADR-0014), so this is a decision waiting, not a
 * payment waiting — which is why the cost is the snapshot on the row and not the catalog's price
 * today. `builtin_key` is what the parent app renders the title from, the way the kid shop does.
 */
export const parentTodayRedemptionSchema = z.object({
  redemption_id: z.string().uuid(),
  child_id: z.string().uuid(),
  first_name: z.string(),
  reward_id: z.string().uuid(),
  builtin_key: builtinRewardKeySchema.nullable(),
  title: z.string().nullable(),
  icon: z.string().nullable(),
  cost_coins: z.number().int(),
  requested_at: z.string().datetime(),
});
export type ParentTodayRedemption = z.infer<typeof parentTodayRedemptionSchema>;

export type ParentToday = {
  /** The household-local chore date the screen is showing. */
  chore_date: IsoDate;
  children: ParentTodayChild[];
  /**
   * The household's undecided Redemptions, oldest first. Household-wide rather than per child: a
   * parent decides these in one pass, and the list is what carries the count on the screen.
   */
  redemptions: ParentTodayRedemption[];
};
