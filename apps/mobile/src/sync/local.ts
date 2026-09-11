import {
  choreDate,
  growthEntriesFor,
  reconcileLedger,
  summariesThatMoved,
  uuid7,
  withinRedoWindow,
  type InstanceStatus,
  type IsoDate,
} from '@chores/shared';
import { and, eq, inArray, sql } from 'drizzle-orm';
import {
  choreInstances,
  completions,
  daySummaries,
  growthEntries,
  ledgerEntries,
  xpEvents,
} from '@/db/schema';
import type { DeviceDb } from '@/db/types';
import { inTransaction } from './engine';
import { enqueueOp } from './outbox';

/**
 * The local half of a tap (docs/spec/03-sync.md, Flow): one SQLite transaction writes the
 * completion, the instance status, the coins and XP the shared rules imply, and the outbox op.
 * The child sees the result before any network call; the server later writes the same rows under
 * the same deterministic ids, so the pull that follows overwrites them with themselves.
 */

/** Everything about this device that never changes between taps. */
export type ChildContext = {
  householdId: string;
  childId: string;
  deviceId: string;
  tz: string;
  dayBoundaryHour: number;
};

/** One tap or one sync run: the child, plus the instant and chore date it happens at. */
export type TapContext = ChildContext & { today: IsoDate; now: Date };

export function tapContext(ctx: ChildContext, now = new Date()): TapContext {
  return { ...ctx, now, today: choreDate(now, ctx.tz, ctx.dayBoundaryHour) };
}

const GRANT_KINDS = ['earn', 'bonus', 'streak', 'clawback'] as const;

/**
 * Recomputes this child's coins, XP, day summaries and grove from the rows on the device.
 *
 * The device holds only its instance window, so the streak carried into the oldest day it knows
 * comes from the stored summary of the day before — a row the server wrote. That makes the numbers
 * here the same ones the server reaches from the full history.
 */
export async function reconcileLocal(db: DeviceDb, ctx: TapContext): Promise<number> {
  const [instances, completionRows, entries, stored] = await Promise.all([
    db
      .select({ id: choreInstances.id, chore_date: choreInstances.chore_date })
      .from(choreInstances)
      .where(eq(choreInstances.child_id, ctx.childId)),
    db
      .select({
        id: completions.id,
        instance_id: completions.instance_id,
        chore_date: completions.chore_date,
        status: completions.status,
      })
      .from(completions)
      .where(eq(completions.child_id, ctx.childId)),
    db
      .select({ id: ledgerEntries.id, kind: ledgerEntries.kind, coins: ledgerEntries.coins })
      .from(ledgerEntries)
      .where(
        and(eq(ledgerEntries.child_id, ctx.childId), inArray(ledgerEntries.kind, [...GRANT_KINDS])),
      ),
    db.select().from(daySummaries).where(eq(daySummaries.child_id, ctx.childId)),
  ]);

  const earliest = instances.map((i) => i.chore_date).sort()[0];
  const before = stored
    .filter((s) => earliest !== undefined && s.chore_date < earliest)
    .sort((a, b) => (a.chore_date < b.chore_date ? 1 : -1))[0];

  const created_at = ctx.now.toISOString();
  const result = reconcileLedger({
    household_id: ctx.householdId,
    child_id: ctx.childId,
    instances,
    completions: completionRows,
    entries: entries.map((e) => ({ ...e, kind: e.kind as (typeof GRANT_KINDS)[number] })),
    streak_before: before?.streak_after ?? 0,
    created_at,
    created_by: ctx.childId,
  });

  if (result.entries.length) {
    await db.insert(ledgerEntries).values(result.entries).onConflictDoNothing();
    await db.insert(xpEvents).values(result.xp_events).onConflictDoNothing();
  }

  const moved = summariesThatMoved(result.summaries, stored);
  if (moved.length) {
    await db
      .insert(daySummaries)
      .values(moved)
      .onConflictDoUpdate({
        target: [daySummaries.child_id, daySummaries.chore_date],
        set: {
          due_count: sql`excluded.due_count`,
          done_count: sql`excluded.done_count`,
          complete: sql`excluded.complete`,
          streak_after: sql`excluded.streak_after`,
        },
      });
  }

  const grove = growthEntriesFor(ctx.householdId, ctx.childId, result.summaries, created_at);
  if (grove.length) await db.insert(growthEntries).values(grove).onConflictDoNothing();

  // What this reconciliation moved the balance by: the earn plus any bonus the tap triggered, or
  // the clawbacks an undo produced. The caller shows this number; reading the balance before and
  // after would also pick up whatever a concurrent pull happened to apply.
  return result.entries.reduce((coins, e) => coins + e.coins, 0);
}

/**
 * The child taps a chore done: it counts now, offline, and syncs later. Returns the coins the tap
 * paid — the per-chore rate, plus the day and streak bonuses if it completed the day.
 */
export async function tapDone(
  db: DeviceDb,
  ctx: TapContext,
  instance: { id: string; chore_id: string },
): Promise<number> {
  return completeInstance(db, ctx, instance, ctx.today);
}

/**
 * The child does a rejected chore again. It counts for the Chore Date the instance belongs to,
 * never for today: the day whose bonus and streak the rejection took back is the day the redo
 * gives them back, and the server writes the completion on that same date (`apply-ops.ts`).
 *
 * Outside the Redo Window there is nothing to do — the day is the parent's by then, and the
 * server would refuse the op `too_late`. The list does not offer one, so this is the backstop
 * for a screen that has been open across a day boundary.
 */
export async function tapRedo(
  db: DeviceDb,
  ctx: TapContext,
  instance: { id: string; chore_id: string; chore_date: IsoDate },
): Promise<number> {
  if (!withinRedoWindow(instance.chore_date, ctx.today)) return 0;
  return completeInstance(db, ctx, instance, instance.chore_date);
}

/** One completion, on `chore_date`: the row, the instance, the ledger and the op, atomically. */
async function completeInstance(
  db: DeviceDb,
  ctx: TapContext,
  instance: { id: string; chore_id: string },
  chore_date: IsoDate,
): Promise<number> {
  return inTransaction(db, async () => {
    const completion_id = uuid7();
    const completed_at = ctx.now.toISOString();
    await db
      .insert(completions)
      .values({
        id: completion_id,
        instance_id: instance.id,
        chore_id: instance.chore_id,
        child_id: ctx.childId,
        household_id: ctx.householdId,
        chore_date,
        completed_at,
        device_id: ctx.deviceId,
        status: 'accepted',
        created_at: completed_at,
      })
      .onConflictDoNothing();
    await db
      .update(choreInstances)
      .set({ status: 'done' })
      .where(eq(choreInstances.id, instance.id));
    const paid = await reconcileLocal(db, ctx);
    await enqueueOp(
      db,
      {
        op_id: uuid7(),
        type: 'complete',
        payload: { completion_id, chore_id: instance.chore_id, chore_date, completed_at },
      },
      ctx.now,
    );
    return paid;
  });
}

/**
 * The same tap again, the same day: the completion stops counting and the coins go back. A day
 * that has passed is the parent's to change, so this does nothing there and the server would
 * refuse it anyway (docs/spec/03-sync.md, conflict rules).
 */
export async function tapUndo(
  db: DeviceDb,
  ctx: TapContext,
  instance: { id: string },
): Promise<number> {
  return inTransaction(db, async () => {
    const [completion] = await db
      .select()
      .from(completions)
      .where(
        and(
          eq(completions.instance_id, instance.id),
          eq(completions.child_id, ctx.childId),
          eq(completions.chore_date, ctx.today),
          eq(completions.status, 'accepted'),
        ),
      );
    if (!completion) return 0;
    await db.update(completions).set({ status: 'undone' }).where(eq(completions.id, completion.id));
    await db
      .update(choreInstances)
      .set({ status: 'due' })
      .where(eq(choreInstances.id, instance.id));
    const clawed = await reconcileLocal(db, ctx);
    await enqueueOp(
      db,
      { op_id: uuid7(), type: 'uncomplete', payload: { completion_id: completion.id } },
      ctx.now,
    );
    return clawed;
  });
}

/** One tap: done if it is not, undone if it is. Returns the coins it moved, signed. */
export async function tapToggle(
  db: DeviceDb,
  ctx: TapContext,
  instance: { id: string; chore_id: string; status: InstanceStatus },
): Promise<number> {
  return instance.status === 'done' ? tapUndo(db, ctx, instance) : tapDone(db, ctx, instance);
}

/** A child's balance: always `SUM(coins)`, never a stored column (ADR-0002). */
export async function balanceOf(db: DeviceDb, childId: string): Promise<number> {
  const [row] = await db
    .select({ coins: sql<number>`coalesce(sum(${ledgerEntries.coins}), 0)` })
    .from(ledgerEntries)
    .where(eq(ledgerEntries.child_id, childId));
  return row?.coins ?? 0;
}
