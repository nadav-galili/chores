import type { LedgerEntry, MoneyLedgerEntry } from '@chores/shared';

/**
 * One shared entry as a row of this database. No XP mirrors a redemption's coins (ADR-0004).
 *
 * It sits on its own because every writer of the ledger needs it and no route owns it: kid ops,
 * redemption decisions, payouts, and adjustments all append the same rows.
 */
export const ledgerRow = (e: LedgerEntry | MoneyLedgerEntry, now: Date) => ({
  id: e.id,
  householdId: e.household_id,
  childId: e.child_id,
  kind: e.kind,
  coins: e.coins,
  moneyAmount: e.money_amount,
  note: 'note' in e ? e.note : null,
  refType: e.ref_type,
  refId: e.ref_id,
  createdAt: now,
  createdBy: e.created_by,
});
