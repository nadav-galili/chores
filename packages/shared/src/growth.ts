import { z } from 'zod';
import { isoDateSchema, type IsoDate } from './chore-date.ts';
import type { DaySummary } from './day-summary.ts';
import { uuid5 } from './uuid5.ts';

/**
 * One `growth_entries` row: a chore date that was Day Complete for a child. Append-only, with
 * no clawback counterpart — the absence of a reversal is ADR-0011 expressed in the schema.
 */
export const growthEntrySchema = z.object({
  id: z.string().uuid(),
  household_id: z.string().uuid(),
  child_id: z.string().uuid(),
  chore_date: isoDateSchema,
  created_at: z.string().datetime(),
});
export type GrowthEntry = z.infer<typeof growthEntrySchema>;

/** Growth entry id = uuid5('grow', child_id, chore_date) (ADR-0010, ADR-0011). */
export const growthId = (childId: string, choreDate: IsoDate) => uuid5('grow', childId, choreDate);

/**
 * One growth entry per day-complete chore date. Append-only and never clawed back: a rejection
 * costs coins, XP and the streak, never a tree, so this reads only `complete` (ADR-0011). A
 * frozen day has no summary row at all, so it plants nothing. Ids are deterministic, so writing
 * these with `ON CONFLICT DO NOTHING` is idempotent under outbox replay.
 */
export function growthEntriesFor(
  householdId: string,
  childId: string,
  summaries: readonly DaySummary[],
  createdAt: string,
): GrowthEntry[] {
  return summaries
    .filter((s) => s.complete)
    .map((s) => ({
      id: growthId(childId, s.chore_date),
      household_id: householdId,
      child_id: childId,
      chore_date: s.chore_date,
      created_at: createdAt,
    }));
}

/**
 * A child's tree stage: always `COUNT(*)` of *their* growth entries, never a stored column
 * (ADR-0011). The child is a parameter rather than the caller's filter because the grove is one
 * household's rows and each child is a separate tree in it.
 */
export function groveStage(
  entries: readonly Pick<GrowthEntry, 'child_id'>[],
  childId: string,
): number {
  return entries.filter((e) => e.child_id === childId).length;
}
