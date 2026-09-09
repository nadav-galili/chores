import { z } from 'zod';
import type { IsoDate } from './chore-date.ts';
import { uuid5 } from './uuid5.ts';

export const choreKindSchema = z.enum(['once', 'daily', 'weekdays']);
export type ChoreKind = z.infer<typeof choreKindSchema>;

export const instanceStatusSchema = z.enum(['due', 'done', 'pending_photo', 'redo']);
export type InstanceStatus = z.infer<typeof instanceStatusSchema>;

/** The slice of a chore row (plus its assignees) that recurrence depends on. */
export type MaterializableChore = {
  id: string;
  household_id: string;
  kind: ChoreKind;
  /** Bit mask, Mon=0 … Sun=6. Only read for `weekdays`. */
  weekday_mask: number | null;
  start_date: IsoDate | null;
  end_date: IsoDate | null;
  /** Only read for `once`. */
  due_date: IsoDate | null;
  deleted_at: string | null;
  assignees: string[];
};

export type ChoreInstance = {
  id: string;
  chore_id: string;
  child_id: string;
  household_id: string;
  chore_date: IsoDate;
  status: InstanceStatus;
};

/** Weekday of a local date, Mon=0 … Sun=6. Calendar arithmetic only, no timezone. */
export function weekdayOf(date: IsoDate): number {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  // Date.UTC on a Y-M-D is a pure calendar lookup; Sunday=0 there.
  return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
}

export function isDueOn(chore: MaterializableChore, date: IsoDate): boolean {
  if (chore.deleted_at !== null) return false;
  // ISO dates compare correctly as strings.
  if (chore.start_date !== null && date < chore.start_date) return false;
  if (chore.end_date !== null && date > chore.end_date) return false;
  switch (chore.kind) {
    case 'once':
      return chore.due_date === date;
    case 'daily':
      return true;
    case 'weekdays':
      return ((chore.weekday_mask ?? 0) & (1 << weekdayOf(date))) !== 0;
  }
}

/** Instance id = uuid5(chore_id, child_id, chore_date) (ADR-0003). */
export function instanceId(choreId: string, childId: string, choreDate: IsoDate): string {
  return uuid5(choreId, childId, choreDate);
}

/** The instances that exist for `choreDate`: one per assignee of every chore due that day. */
export function materializeInstances(
  chores: readonly MaterializableChore[],
  choreDate: IsoDate,
): ChoreInstance[] {
  return chores
    .filter((chore) => isDueOn(chore, choreDate))
    .flatMap((chore) =>
      chore.assignees.map((childId) => ({
        id: instanceId(chore.id, childId, choreDate),
        chore_id: chore.id,
        child_id: childId,
        household_id: chore.household_id,
        chore_date: choreDate,
        status: 'due' as const,
      })),
    );
}
