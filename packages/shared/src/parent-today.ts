import { z } from 'zod';
import type { IsoDate } from './chore-date.ts';
import { instanceStatusSchema } from './materialize.ts';

/** One instance on the parent's today screen: what it is, and when it was done. */
export const parentTodayItemSchema = z.object({
  instance_id: z.string().uuid(),
  chore_id: z.string().uuid(),
  title: z.string(),
  icon: z.string().nullable(),
  status: instanceStatusSchema,
  /** The accepted completion's instant, or null while the instance is still due. */
  completed_at: z.string().datetime().nullable(),
  /**
   * The accepted completion's id, or null while the instance is still due. It is the only thing
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

export type ParentToday = {
  /** The household-local chore date the screen is showing. */
  chore_date: IsoDate;
  children: ParentTodayChild[];
};
