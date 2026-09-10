import { materializeInstances, type IsoDate, type MaterializableChore } from '@chores/shared';
import type { Db } from './db/client.ts';
import { choreInstances, chores } from './db/schema.ts';

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
/** Either a transaction or the pool: both write instances the same way. */
export type Writer = Db | Tx;
type ChoreRow = typeof chores.$inferSelect;

/** A chore row plus the children it is assigned to, as the recurrence rules want it. */
export function materializable(row: ChoreRow, assignees: string[]): MaterializableChore {
  return {
    id: row.id,
    household_id: row.householdId,
    kind: row.kind,
    weekday_mask: row.weekdayMask,
    start_date: row.startDate,
    end_date: row.endDate,
    due_date: row.dueDate,
    deleted_at: row.deletedAt ? row.deletedAt.toISOString() : null,
    assignees,
  };
}

/**
 * Writes the instances due on `date`, creating what is missing. Deterministic ids make a repeat,
 * or a race with a kid device or the cron, a no-op (ADR-0003).
 */
export async function writeInstances(
  writer: Writer,
  chores: readonly MaterializableChore[],
  date: IsoDate,
) {
  const instances = materializeInstances(chores, date);
  if (!instances.length) return;
  await writer
    .insert(choreInstances)
    .values(
      instances.map((i) => ({
        id: i.id,
        choreId: i.chore_id,
        childId: i.child_id,
        householdId: i.household_id,
        choreDate: i.chore_date,
        status: i.status,
      })),
    )
    .onConflictDoNothing();
}
