import { clawbackId, type LedgerEntry } from './ledger.ts';
import { uuid5 } from './uuid5.ts';

/**
 * The ledger side of a Redemption (ADR-0014). The coins leave when the child asks, not when a
 * parent approves: the `redeem` entry is written at request time, approval writes nothing at all,
 * and a decline or a cancel refunds by clawing that entry back.
 *
 * Both refunds are the same row — same id, same value — because the id is derived from the entry
 * being reversed and not from who reversed it. A parent approving at the moment a child cancels
 * can therefore only ever produce one refund however the two writes interleave; the status column
 * records which story it was, and the ledger cannot double-refund.
 *
 * None of this is reconciliation's business: `reconcileLedger` grants `earn`, `bonus` and
 * `streak` from the facts and never reverses a `redeem`, so the entries here are written by the
 * path that writes the Redemption row and by nothing else.
 */

/** The entry the request writes: `uuid5('redeem', redemption_id)` (ADR-0010). */
export const redeemEntryId = (redemptionId: string) => uuid5('redeem', redemptionId);

/** The refund a decline or a cancel writes: a clawback of the redeem entry, one id both ways. */
export const redemptionRefundId = (redemptionId: string) => clawbackId(redeemEntryId(redemptionId));

/** Everything both entries are built from. `cost_coins` is the snapshot on the Redemption row. */
export type RedemptionFacts = {
  household_id: string;
  child_id: string;
  redemption_id: string;
  cost_coins: number;
  created_at: string;
  created_by: string;
};

/**
 * The coins leaving, at `−cost`. No XP event mirrors it: coins and pet XP are separate currencies
 * and spending coins never costs a child their pet's progress (ADR-0004).
 */
export function redeemEntry(f: RedemptionFacts): LedgerEntry {
  return {
    id: redeemEntryId(f.redemption_id),
    household_id: f.household_id,
    child_id: f.child_id,
    kind: 'redeem',
    coins: -f.cost_coins,
    money_amount: null,
    ref_type: 'redemption',
    ref_id: f.redemption_id,
    created_at: f.created_at,
    created_by: f.created_by,
  };
}

/** The coins coming back, at `+cost`, whether a parent declined or the child changed their mind. */
export function refundEntry(f: RedemptionFacts): LedgerEntry {
  return {
    id: redemptionRefundId(f.redemption_id),
    household_id: f.household_id,
    child_id: f.child_id,
    kind: 'clawback',
    coins: f.cost_coins,
    money_amount: null,
    ref_type: 'ledger_entry',
    ref_id: redeemEntryId(f.redemption_id),
    created_at: f.created_at,
    created_by: f.created_by,
  };
}

export type RequestRedemptionResult =
  { ok: true; entry: LedgerEntry } | { ok: false; reason: 'insufficient_coins' };

/**
 * The request, decided against a balance. Overspending is structurally impossible once the coins
 * are gone, but a balance can shrink under a device that has not pulled — a parent's Rejection
 * claws back coins the child already believed they had — so the server revalidates here and the
 * device asks the same question before it writes anything.
 *
 * `balance` is `SUM(coins)` as read at that moment; nothing is ever held aside.
 */
export function requestRedemption(
  f: RedemptionFacts & { balance: number },
): RequestRedemptionResult {
  if (f.balance - f.cost_coins < 0) return { ok: false, reason: 'insufficient_coins' };
  return { ok: true, entry: redeemEntry(f) };
}
