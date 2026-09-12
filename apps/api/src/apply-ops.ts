import {
  choreDate,
  growthEntriesFor,
  instanceId,
  isDueOn,
  KID_OP_TYPES,
  kidOpSchema,
  reconcileLedger,
  refundEntry,
  requestRedemption,
  resolveChoreDate,
  summariesThatMoved,
  withinRedoWindow,
  type IsoDate,
  type KidOpType,
  type LedgerEntry,
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
  redemptions,
  rewards,
  xpEvents,
} from './db/schema.ts';

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
type Household = typeof households.$inferSelect;

/** Whose rows a reconciliation recomputes, when, and whose name goes on what it writes. */
export type ReconcileContext = {
  childId: string;
  householdId: string;
  now: Date;
  /** `created_by` on every ledger row written: the child who tapped, or the parent who rejected. */
  createdBy: string;
};

export type OpContext = ReconcileContext & {
  deviceId: string;
  household: Household;
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

/**
 * The ops whose rows reconciliation reads. A push token is not one, and neither is a redemption:
 * `reconcileLedger` works from completions and never reverses a `redeem` (ADR-0014), so running
 * it over a request or a cancel would recompute the same numbers and touch neither entry.
 */
const RECONCILED_OP_TYPES: ReadonlySet<KidOpType> = new Set<KidOpType>(['complete', 'uncomplete']);

const reject = (reason: RejectReason): StoredResult => ({ status: 'rejected', reason });

/** One shared entry as a row of this database. No XP mirrors a redemption's coins (ADR-0004). */
export const ledgerRow = (e: LedgerEntry, now: Date) => ({
  id: e.id,
  householdId: e.household_id,
  childId: e.child_id,
  kind: e.kind,
  coins: e.coins,
  moneyAmount: e.money_amount,
  refType: e.ref_type,
  refId: e.ref_id,
  createdAt: now,
  createdBy: e.created_by,
});

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
    // The locale rides along, so the push the cron sends is in the language the child reads.
    await tx
      .update(childDevices)
      .set({
        expoPushToken: op.payload.expo_push_token,
        // An op that carries no locale says nothing about the language: leave the one on file.
        ...(op.payload.locale ? { locale: op.payload.locale } : {}),
      })
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

    const statusAt = async (date: IsoDate) => {
      const [row] = await tx
        .select({ status: choreInstances.status })
        .from(choreInstances)
        .where(eq(choreInstances.id, instanceId(chore_id, ctx.childId, date)));
      return row?.status;
    };
    const exists = async (date: IsoDate) => (await statusAt(date)) !== undefined;
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
    /**
     * The ±1 day clock guard applies only when the instance would have to be created
     * (docs/spec/02-data-model.md, timezone rules): it exists so a device with a wrong clock
     * cannot invent a day, and an instance the server already materialized was not invented by a
     * device. A completion naming one is written on that instance's chore date however far back
     * it is, which is what makes the Redo Window work at all.
     */
    const chore_date = (await exists(claimed))
      ? claimed
      : !resolved.date_adjusted && (await plausible(resolved.chore_date))
        ? resolved.chore_date
        : computed;
    const date_adjusted = chore_date !== claimed;
    /**
     * The Redo Window bounds a redo and nothing else (docs/spec/03-sync.md): past it, a chore the
     * parent sent back is theirs to change again, not the child's. A `due` instance is a first
     * completion of a day that was genuinely the child's, so a device back from three days offline
     * is written on its own Chore Date rather than refused and undone. Creating an instance is
     * bounded by the ±1 clock guard above, not by this.
     */
    const today = choreDate(ctx.now, ctx.household.tz, ctx.household.dayBoundaryHour);
    const status = await statusAt(chore_date);
    if (status === 'redo' && !withinRedoWindow(chore_date, today)) return reject('too_late');
    const instance_id = instanceId(chore_id, ctx.childId, chore_date);
    if (!assigned && status === undefined) {
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
    // A redo is due again after a parent's rejection, so the child may complete it; a
    // `pending_photo` instance is waiting on a parent and is not theirs to flip.
    await tx
      .update(choreInstances)
      .set({ status: 'done' })
      .where(
        and(eq(choreInstances.id, instance_id), inArray(choreInstances.status, ['due', 'redo'])),
      );
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

  if (op.type === 'request_redemption') {
    const { redemption_id, reward_id, requested_at } = op.payload;
    // The row already being here is the device asking twice under a new op id — its optimistic
    // write reached us once already, and the coins have gone. Writing anything now would spend
    // them twice, so this answers yes and moves nothing.
    const [existing] = await tx.select().from(redemptions).where(eq(redemptions.id, redemption_id));
    if (existing) return existing.childId === ctx.childId ? ack() : reject('unknown_redemption');

    // What a reward costs is the catalog's to say, not the device's; a hidden or deleted reward
    // is not in the shop at all.
    const [reward] = await tx
      .select()
      .from(rewards)
      .where(and(eq(rewards.id, reward_id), eq(rewards.householdId, ctx.householdId)));
    if (!reward || !reward.active || reward.deletedAt) return reject('unknown_reward');

    // Balance is `SUM(coins)`, read here and held aside nowhere (ADR-0014). The device asked the
    // same question before it wrote, but a parent's Rejection can have clawed back coins it has
    // not pulled yet, so this refusal is ordinary rather than a sign of a bad device.
    const [held] = await tx
      .select({ coins: sql<number>`coalesce(sum(${ledgerEntries.coins}), 0)::int` })
      .from(ledgerEntries)
      .where(eq(ledgerEntries.childId, ctx.childId));
    const decided = requestRedemption({
      household_id: ctx.householdId,
      child_id: ctx.childId,
      redemption_id,
      cost_coins: reward.costCoins,
      created_at: ctx.now.toISOString(),
      created_by: ctx.childId,
      balance: held?.coins ?? 0,
    });
    if (!decided.ok) return reject(decided.reason);

    await tx
      .insert(redemptions)
      .values({
        id: redemption_id,
        rewardId: reward.id,
        childId: ctx.childId,
        householdId: ctx.householdId,
        // A snapshot: a parent re-pricing the reward later does not rewrite what was asked for.
        costCoins: reward.costCoins,
        status: 'requested',
        requestedAt: new Date(requested_at),
      })
      .onConflictDoNothing();
    await tx.insert(ledgerEntries).values(ledgerRow(decided.entry, ctx.now)).onConflictDoNothing();
    return ack();
  }

  if (op.type === 'cancel_redemption') {
    const { redemption_id } = op.payload;
    // Locked: a parent deciding at this moment holds or waits for the same row, so the status
    // read below is the one that decided, and only one of the two writes a refund.
    const [row] = await tx
      .select()
      .from(redemptions)
      .where(and(eq(redemptions.id, redemption_id), eq(redemptions.childId, ctx.childId)))
      .for('update');
    if (!row) return reject('unknown_redemption');
    // Approved or declined, the parent got there first and the coins are theirs to move.
    if (row.status === 'approved' || row.status === 'declined') return reject('already_decided');
    // Already cancelled: the refund was written under the id both paths share, so this is the
    // same intent arriving twice and there is nothing left to do.
    if (row.status === 'requested') {
      await tx
        .update(redemptions)
        .set({ status: 'cancelled', decidedAt: ctx.now })
        .where(and(eq(redemptions.id, redemption_id), eq(redemptions.status, 'requested')));
      const refund = refundEntry({
        household_id: ctx.householdId,
        child_id: ctx.childId,
        redemption_id,
        cost_coins: row.costCoins,
        created_at: ctx.now.toISOString(),
        created_by: ctx.childId,
      });
      await tx.insert(ledgerEntries).values(ledgerRow(refund, ctx.now)).onConflictDoNothing();
    }
    return ack();
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
export async function reconcileChild(tx: Tx, ctx: ReconcileContext): Promise<void> {
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
    created_by: ctx.createdBy,
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
      // `raw.type` is unvalidated wire input, widened here the way `KID_OP_TYPES` is above; the
      // set itself stays typed so a renamed op type fails to compile rather than going quiet.
      const reconciled = (RECONCILED_OP_TYPES as ReadonlySet<string>).has(raw.type);
      if (result.status === 'acked' && reconciled) changed = true;
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
