import { z } from 'zod';
import type { IsoDate } from './chore-date.ts';

export const completionStatusSchema = z.enum(['accepted', 'pending_photo', 'rejected']);
export type CompletionStatus = z.infer<typeof completionStatusSchema>;

/** One `day_summaries` row: what a child was due and did on one chore date. */
export type DaySummary = {
  child_id: string;
  chore_date: IsoDate;
  due_count: number;
  done_count: number;
  /** Day Complete: at least one instance due and every one of them done. A frozen day is not complete. */
  complete: boolean;
  /** Streak as of the end of this chore date. */
  streak_after: number;
};

/** The slice of an instance a day summary depends on. */
export type SummaryInstance = { id: string; chore_date: IsoDate };

/** The slice of a completion a day summary depends on. Only `accepted` counts as done. */
export type SummaryCompletion = {
  instance_id: string;
  chore_date: IsoDate;
  status: CompletionStatus;
};

export type SummarizeOptions = {
  /** Streak as of the day before the earliest instance given (from a stored summary). Default 0. */
  streak_before?: number;
};

/**
 * Day summaries for one child, oldest first, one per chore date that has instances.
 * Streak: a complete day extends it, a zero-due (frozen) day keeps it, any other day breaks it.
 * Dates with no instances at all are frozen days and simply do not appear.
 */
export function summarizeDays(
  childId: string,
  instances: readonly SummaryInstance[],
  completions: readonly SummaryCompletion[],
  options: SummarizeOptions = {},
): DaySummary[] {
  const doneInstances = new Set(
    completions.filter((c) => c.status === 'accepted').map((c) => c.instance_id),
  );
  const byDate = new Map<IsoDate, { due: number; done: number }>();
  for (const instance of instances) {
    const day = byDate.get(instance.chore_date) ?? { due: 0, done: 0 };
    day.due += 1;
    if (doneInstances.has(instance.id)) day.done += 1;
    byDate.set(instance.chore_date, day);
  }

  let streak = options.streak_before ?? 0;
  return [...byDate.keys()].sort().map((chore_date) => {
    const { due, done } = byDate.get(chore_date)!;
    const complete = due > 0 && done === due;
    if (complete) streak += 1;
    else if (due > 0) streak = 0;
    return {
      child_id: childId,
      chore_date,
      due_count: due,
      done_count: done,
      complete,
      streak_after: streak,
    };
  });
}

/**
 * The streak to show on `today`: today's own streak once today is complete, otherwise the
 * streak carried into today (today is still in progress, so it neither extends nor breaks).
 */
export function currentStreak(summaries: readonly DaySummary[], today: IsoDate): number {
  const todays = summaries.find((s) => s.chore_date === today);
  if (todays?.complete) return todays.streak_after;
  const before = summaries
    .filter((s) => s.chore_date < today)
    .sort((a, b) => (a.chore_date < b.chore_date ? 1 : -1));
  return before[0]?.streak_after ?? 0;
}
