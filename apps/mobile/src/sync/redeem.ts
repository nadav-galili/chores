import { refundEntry, requestRedemption, uuid7, type RedemptionStatus } from '@chores/shared';
import { and, eq } from 'drizzle-orm';
import { ledgerEntries, redemptions } from '@/db/schema';
import type { DeviceDb } from '@/db/types';
import { inTransaction } from './engine';
import { balanceOf, type TapContext } from './local';
import { enqueueOp } from './outbox';

/**
 * The local half of the reward shop (ADR-0014). The coins leave the moment the child asks, so the
 * balance on screen is the truth about what is left to spend, offline and immediately.
 *
 * A request writes three rows in one SQLite transaction — the `redemptions` row, the `redeem`
 * ledger entry at `−cost` under `uuid5('redeem', redemption_id)`, and the outbox op — so the
 * intent and its optimistic result can never come apart. The server writes the same rows under
 * the same deterministic ids, and the pull that follows overwrites them with themselves.
 *
 * Nothing here goes through `reconcileLocal`: reconciliation recomputes what the facts of a
 * child's completions imply, and a redemption is not one of those facts.
 */

export type RedeemResult =
  { ok: true; redemption_id: string } | { ok: false; reason: 'insufficient_coins' };

/** What the shop needs of a catalog row to spend against it. */
export type RedeemableReward = { id: string; cost_coins: number };

/**
 * The child asks for a reward. Refused here when `SUM(coins)` does not cover it, so a child is
 * never disappointed by a decision they could not have made; the server asks the same question
 * again, because a parent's Rejection can have taken coins this device has not pulled.
 */
export async function askForReward(
  db: DeviceDb,
  ctx: TapContext,
  reward: RedeemableReward,
): Promise<RedeemResult> {
  return inTransaction(db, async () => {
    const redemption_id = uuid7();
    const requested_at = ctx.now.toISOString();
    const decided = requestRedemption({
      household_id: ctx.householdId,
      child_id: ctx.childId,
      redemption_id,
      cost_coins: reward.cost_coins,
      created_at: requested_at,
      created_by: ctx.childId,
      balance: await balanceOf(db, ctx.childId),
    });
    if (!decided.ok) return { ok: false as const, reason: decided.reason };

    await db.insert(redemptions).values({
      id: redemption_id,
      reward_id: reward.id,
      child_id: ctx.childId,
      household_id: ctx.householdId,
      cost_coins: reward.cost_coins,
      status: 'requested',
      requested_at,
      decided_at: null,
      decided_by: null,
    });
    // No XP event mirrors it: coins and pet XP are separate, and spending never costs the pet
    // its progress (ADR-0004).
    await db.insert(ledgerEntries).values(decided.entry).onConflictDoNothing();
    await enqueueOp(
      db,
      {
        op_id: uuid7(),
        type: 'request_redemption',
        payload: { redemption_id, reward_id: reward.id, requested_at },
      },
      ctx.now,
    );
    return { ok: true as const, redemption_id };
  });
}

/**
 * The child changes their mind. The refund is a clawback of the redeem entry, written under the
 * id a parent's decline would use too, so the two can race and still refund once. A request a
 * parent has already decided is theirs, not the child's: this does nothing and the server, which
 * knows the decision this device may not have pulled, answers `already_decided`.
 */
export async function cancelRedemption(
  db: DeviceDb,
  ctx: TapContext,
  redemptionId: string,
): Promise<boolean> {
  return inTransaction(db, async () => {
    const [row] = await db
      .select()
      .from(redemptions)
      .where(and(eq(redemptions.id, redemptionId), eq(redemptions.child_id, ctx.childId)));
    if (!row || row.status !== 'requested') return false;

    const decided_at = ctx.now.toISOString();
    await db
      .update(redemptions)
      .set({ status: 'cancelled' satisfies RedemptionStatus, decided_at })
      .where(eq(redemptions.id, redemptionId));
    await db
      .insert(ledgerEntries)
      .values(
        refundEntry({
          household_id: ctx.householdId,
          child_id: ctx.childId,
          redemption_id: redemptionId,
          cost_coins: row.cost_coins,
          created_at: decided_at,
          created_by: ctx.childId,
        }),
      )
      .onConflictDoNothing();
    await enqueueOp(
      db,
      { op_id: uuid7(), type: 'cancel_redemption', payload: { redemption_id: redemptionId } },
      ctx.now,
    );
    return true;
  });
}
