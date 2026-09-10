import {
  choreDate,
  growthEntriesFor,
  instanceId,
  isDueOn,
  KID_OP_TYPES,
  kidOpSchema,
  reconcileLedger,
  resolveChoreDate,
  summariesThatMoved,
  type IsoDate,
  type RejectReason,
  type SyncOp,
  type SyncResponse,
} from '@chores/shared';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { Db } from './db/client.ts';
import {
  appliedOps,
  childDevices,
  choreAssignees,
  choreInstances,
  chores,
  completions,
  daySummaries,
  growthEntries,
  households,
  ledgerEntries,
  xpEvents,
} from './db/schema.ts';

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
type Household = typeof households.$inferSelect;

export type OpContext = {
  deviceId: string;
  childId: string;
  householdId: string;
  household: Household;
  now: Date;
};

type Ack = SyncResponse['acked'][number];
type Rejection = SyncResponse['rejected'][number];
/** What `applied_ops.result` holds, so a replay answers exactly what the first attempt did. */
type StoredResult =
  { status: 'acked'; date_adjusted?: boolean } | { status: 'rejected'; reason: RejectReason };

export type ApplyOpsResult = {
  acked: Ack[];
  rejected: Rejection[];
  /** True when any op actually landed, so the caller knows to recompute coins, XP and summaries. */
  changed: boolean;
};

const reject = (reason: RejectReason): StoredResult => ({ status: 'rejected', reason });
const ack = (date_adjusted = false): StoredResult =>
  date_adjusted ? { status: 'acked', date_adjusted: true } : { status: 'acked' };

/**
 * Applies one kid op. Returns what to answer; every write it does is idempotent on its own, so a
 * replay that slips past `applied_ops` (a crash between the write and the ack) still lands once.
 */
async function applyOne(tx: Tx, ctx: OpContext, raw: SyncOp): Promise<StoredResult> {
  const parsed = kidOpSchema.safeParse(raw);
  if (!parsed.success) {
    const known = (KID_OP_TYPES as readonly string[]).includes(raw.type);
    return reject(known ? 'invalid_payload' : 'unknown_op');
  }
  const op = parsed.data;

  if (op.type === 'register_push_token') {
    // A token rots, so the device re-sends it on every open; the device is the one on the token.
    await tx
      .update(childDevices)
      .set({ expoPushToken: op.payload.expo_push_token })
      .where(eq(childDevices.id, ctx.deviceId));
    return ack();
  }

  if (op.type === 'complete') {
    const { chore_id, completion_id, completed_at, chore_date: claimed } = op.payload;
    // A deleted chore still pays (docs/spec/03-sync.md); one that was never this child's does not.
    const [chore] = await tx
      .select()
      .from(chores)
      .where(and(eq(chores.id, chore_id), eq(chores.householdId, ctx.householdId)));
    if (!chore) return reject('unknown_chore');
    const [assigned] = await tx
      .select({ choreId: choreAssignees.choreId })
      .from(choreAssignees)
      .where(and(eq(choreAssignees.choreId, chore_id), eq(choreAssignees.childId, ctx.childId)));

    const exists = async (date: IsoDate) => {
      const [row] = await tx
        .select({ id: choreInstances.id })
        .from(choreInstances)
        .where(eq(choreInstances.id, instanceId(chore_id, ctx.childId, date)));
      return row !== undefined;
    };
    /**
     * A day the chore can honestly belong to: one that already has an instance, or one the
     * recurrence puts it on. Deletion is ignored here — a deleted chore still pays — but the
     * recurrence is not, so a device a day out cannot invent a Tuesday instance of a weekend
     * chore and leave that day forever incomplete.
     */
    const plausible = async (date: IsoDate) =>
      (await exists(date)) ||
      isDueOn(
        {
          id: chore.id,
          household_id: chore.householdId,
          kind: chore.kind,
          weekday_mask: chore.weekdayMask,
          start_date: chore.startDate,
          end_date: chore.endDate,
          due_date: chore.dueDate,
          deleted_at: null,
          assignees: [ctx.childId],
        },
        date,
      );

    const completedAt = new Date(completed_at);
    const computed = choreDate(completedAt, ctx.household.tz, ctx.household.dayBoundaryHour);
    const resolved = resolveChoreDate(claimed, computed);
    const chore_date =
      !resolved.date_adjusted && (await plausible(resolved.chore_date))
        ? resolved.chore_date
        : computed;
    const date_adjusted = chore_date !== claimed;
    const instance_id = instanceId(chore_id, ctx.childId, chore_date);
    if (!assigned && !(await exists(chore_date))) {
      // Unassigned mid-day: the instance the child is looking at still counts, nothing else does.
      return reject('unknown_chore');
    }

    await tx
      .insert(choreInstances)
      .values({
        id: instance_id,
        choreId: chore_id,
        childId: ctx.childId,
        householdId: ctx.householdId,
        choreDate: chore_date,
        status: 'done',
      })
      .onConflictDoNothing();
    await tx
      .update(choreInstances)
      .set({ status: 'done' })
      .where(and(eq(choreInstances.id, instance_id), eq(choreInstances.status, 'due')));
    await tx
      .insert(completions)
      .values({
        id: completion_id,
        instanceId: instance_id,
        choreId: chore_id,
        childId: ctx.childId,
        householdId: ctx.householdId,
        choreDate: chore_date,
        completedAt,
        deviceId: ctx.deviceId,
        status: 'accepted',
        createdAt: ctx.now,
      })
      .onConflictDoNothing();
    return ack(date_adjusted);
  }

  const [completion] = await tx
    .select()
    .from(completions)
    .where(and(eq(completions.id, op.payload.completion_id), eq(completions.childId, ctx.childId)));
  if (!completion) return reject('unknown_completion');
  if (completion.status === 'undone') return ack();
  if (completion.status === 'rejected') return reject('already_decided');
  const today = choreDate(ctx.now, ctx.household.tz, ctx.household.dayBoundaryHour);
  if (completion.choreDate !== today) return reject('too_late');

  await tx.update(completions).set({ status: 'undone' }).where(eq(completions.id, completion.id));
  await tx
    .update(choreInstances)
    .set({ status: 'due' })
    .where(eq(choreInstances.id, completion.instanceId));
  return ack();
}

/**
 * Coins, XP, day summaries and growth for one child, recomputed from the facts the database now
 * holds. Reads the child's whole history rather than a window so streaks and their bonuses are
 * the same numbers whoever recomputes them; a child's history is a few rows a day.
 */
export async function reconcileChild(tx: Tx, ctx: OpContext): Promise<void> {
  const [instanceRows, completionRows, entryRows, summaryRows] = await Promise.all([
    tx
      .select({ id: choreInstances.id, chore_date: choreInstances.choreDate })
      .from(choreInstances)
      .where(eq(choreInstances.childId, ctx.childId)),
    tx
      .select({
        id: completions.id,
        instance_id: completions.instanceId,
        chore_date: completions.choreDate,
        status: completions.status,
      })
      .from(completions)
      .where(eq(completions.childId, ctx.childId)),
    tx
      .select({ id: ledgerEntries.id, kind: ledgerEntries.kind, coins: ledgerEntries.coins })
      .from(ledgerEntries)
      .where(
        and(
          eq(ledgerEntries.childId, ctx.childId),
          inArray(ledgerEntries.kind, ['earn', 'bonus', 'streak', 'clawback']),
        ),
      ),
    tx.select().from(daySummaries).where(eq(daySummaries.childId, ctx.childId)),
  ]);

  const createdAt = ctx.now.toISOString();
  const { entries, xp_events, summaries } = reconcileLedger({
    household_id: ctx.householdId,
    child_id: ctx.childId,
    instances: instanceRows,
    completions: completionRows,
    entries: entryRows,
    created_at: createdAt,
    created_by: ctx.childId,
  });

  if (entries.length) {
    await tx
      .insert(ledgerEntries)
      .values(
        entries.map((e) => ({
          id: e.id,
          householdId: e.household_id,
          childId: e.child_id,
          kind: e.kind,
          coins: e.coins,
          moneyAmount: e.money_amount,
          refType: e.ref_type,
          refId: e.ref_id,
          createdAt: ctx.now,
          createdBy: e.created_by,
        })),
      )
      .onConflictDoNothing();
    await tx
      .insert(xpEvents)
      .values(
        xp_events.map((x) => ({
          id: x.id,
          childId: x.child_id,
          xp: x.xp,
          refEntryId: x.ref_entry_id,
          createdAt: ctx.now,
        })),
      )
      .onConflictDoNothing();
  }

  const moved = summariesThatMoved(
    summaries,
    summaryRows.map((r) => ({
      child_id: r.childId,
      chore_date: r.choreDate,
      due_count: r.dueCount,
      done_count: r.doneCount,
      complete: r.complete,
      streak_after: r.streakAfter,
    })),
  );
  if (moved.length) {
    await tx
      .insert(daySummaries)
      .values(
        moved.map((s) => ({
          childId: s.child_id,
          choreDate: s.chore_date,
          dueCount: s.due_count,
          doneCount: s.done_count,
          complete: s.complete,
          streakAfter: s.streak_after,
        })),
      )
      .onConflictDoUpdate({
        target: [daySummaries.childId, daySummaries.choreDate],
        set: {
          dueCount: sql`excluded.due_count`,
          doneCount: sql`excluded.done_count`,
          complete: sql`excluded.complete`,
          streakAfter: sql`excluded.streak_after`,
        },
      });
  }

  const growth = growthEntriesFor(ctx.householdId, ctx.childId, summaries, createdAt);
  if (growth.length) {
    await tx
      .insert(growthEntries)
      .values(
        growth.map((g) => ({
          id: g.id,
          householdId: g.household_id,
          childId: g.child_id,
          choreDate: g.chore_date,
          createdAt: ctx.now,
        })),
      )
      .onConflictDoNothing();
  }
}

/** Applies every op in order, each exactly once, and answers what the device should record. */
export async function applyOps(tx: Tx, ctx: OpContext, ops: SyncOp[]): Promise<ApplyOpsResult> {
  const acked: Ack[] = [];
  const rejected: Rejection[] = [];
  let changed = false;

  for (const raw of ops) {
    const [seen] = await tx
      .select({ result: appliedOps.result })
      .from(appliedOps)
      .where(eq(appliedOps.opId, raw.op_id));
    let result = seen?.result as StoredResult | undefined;
    if (!result) {
      result = await applyOne(tx, ctx, raw);
      await tx
        .insert(appliedOps)
        .values({ opId: raw.op_id, deviceId: ctx.deviceId, result, at: ctx.now })
        .onConflictDoNothing();
      // Only a completion changes what a child has earned; a push token does not.
      if (result.status === 'acked' && raw.type !== 'register_push_token') changed = true;
    }
    if (result.status === 'acked') {
      acked.push(
        result.date_adjusted ? { op_id: raw.op_id, date_adjusted: true } : { op_id: raw.op_id },
      );
    } else {
      rejected.push({ op_id: raw.op_id, reason: result.reason });
    }
  }
  return { acked, rejected, changed };
}
