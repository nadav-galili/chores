import type { LedgerEntry } from '@chores/shared';

/**
 * One shared entry as a row of this database. No XP mirrors a redemption's coins (ADR-0004).
 *
 * It sits on its own because both writers of the ledger need it and neither owns it: the kid-op
 * applier (`apply-ops.ts`) and the parent's decision route (`redemptions.ts`) append the same
 * rows, and a parent route reaching into the op applier for a row shaper would say the ledger
 * belongs to the kid device, which it does not.
 */
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
