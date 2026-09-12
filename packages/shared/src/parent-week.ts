import { z } from 'zod';
import type { IsoDate } from './chore-date.ts';
import { instanceStatusSchema } from './materialize.ts';

/**
 * One cell of the seven-day grid: one chore on one Chore Date.
 *
 * `status` is the Instance's, not the completion's — a completion a parent rejected leaves the
 * Instance at `redo`, and a redo waiting to be done again is exactly what the parent needs to
 * see from here.
 */
export const parentWeekCellSchema = z.object({
  instance_id: z.string().uuid(),
  chore_date: z.string(),
  status: instanceStatusSchema,
  /**
   * The accepted completion still holding this Instance up, or null. It is the only thing on a
   * parent surface that can name a completion, so it is what makes a rejection from a cell of an
   * earlier day reachable at all.
   */
  completion_id: z.string().uuid().nullable(),
});
export type ParentWeekCell = z.infer<typeof parentWeekCellSchema>;

/**
 * One row of the grid. `cells` is sparse: a chore has a cell only on the Chore Dates it had an
 * Instance on, because a weekly chore is not due every day and an empty square is the truth
 * there. The client reads them by `chore_date`.
 */
export const parentWeekChoreSchema = z.object({
  chore_id: z.string().uuid(),
  title: z.string(),
  icon: z.string().nullable(),
  cells: z.array(parentWeekCellSchema),
});
export type ParentWeekChore = z.infer<typeof parentWeekChoreSchema>;

/**
 * One child's last seven Chore Dates, as chores against days. Ungated: seven days is what the
 * free tier promises (docs/spec/01-product.md, Tiers), and it is also the only way a parent
 * reaches a completion from an earlier day — the Digest that prompts a rejection arrives at
 * 20:00 and the parent acts the next morning, still inside the Redo Window.
 */
export type ParentWeek = {
  child_id: string;
  /** The seven Chore Dates, oldest first, ending on the household's today. */
  chore_dates: IsoDate[];
  /** Only chores with at least one Instance in the window, by title. */
  chores: ParentWeekChore[];
};
