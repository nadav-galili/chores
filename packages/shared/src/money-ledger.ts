import type { LedgerEntry } from './ledger.ts';

const MINOR_UNITS_PER_UNIT = 100;

/** Convert coins into minor currency units at the household's coin-to-unit rate. */
export function coinsToMoneyAmount(coins: number, coinsPerUnit: number): number {
  return Math.round((coins * MINOR_UNITS_PER_UNIT) / coinsPerUnit);
}

/** Balance is always the sum of signed coins; it is never stored. */
export function balanceOf(entries: readonly Pick<LedgerEntry, 'coins'>[]): number {
  return entries.reduce((balance, entry) => balance + entry.coins, 0);
}

/** Owed money is the sum of payout amounts, expressed in minor currency units. */
export function owedOf(entries: readonly Pick<LedgerEntry, 'money_amount'>[]): number {
  return entries.reduce((owed, entry) => owed + (entry.money_amount ?? 0), 0);
}

export type MoneyLedgerEntry = LedgerEntry & { note: string | null };

export type PayoutFacts = {
  /** Client-generated UUID; payouts are not derived from a deterministic fact. */
  id: string;
  household_id: string;
  child_id: string;
  /** The positive number of coins being converted. */
  coins: number;
  coins_per_unit: number;
  created_at: string;
  created_by: string;
};

/** One pot, two exits: a payout spends coins and adds the converted money to what is owed. */
export function payoutEntry(facts: PayoutFacts): MoneyLedgerEntry {
  return {
    id: facts.id,
    household_id: facts.household_id,
    child_id: facts.child_id,
    kind: 'payout',
    coins: -facts.coins,
    money_amount: coinsToMoneyAmount(facts.coins, facts.coins_per_unit),
    note: null,
    ref_type: null,
    ref_id: null,
    created_at: facts.created_at,
    created_by: facts.created_by,
  };
}

export type RequestPayoutResult =
  { ok: true; entry: MoneyLedgerEntry } | { ok: false; reason: 'insufficient_coins' };

/** Refuse a payout that would make the child's `SUM(coins)` balance negative. */
export function requestPayout(facts: PayoutFacts & { balance: number }): RequestPayoutResult {
  if (facts.balance - facts.coins < 0) return { ok: false, reason: 'insufficient_coins' };
  return { ok: true, entry: payoutEntry(facts) };
}

export type AdjustmentFacts = {
  /** Client-generated UUID; adjustments are not derived from a deterministic fact. */
  id: string;
  household_id: string;
  child_id: string;
  /** Signed correction. */
  coins: number;
  note: string;
  created_at: string;
  created_by: string;
};

/** A signed coin correction whose explanation is first-class data, never a ledger reference. */
export function adjustEntry(facts: AdjustmentFacts): MoneyLedgerEntry {
  return {
    id: facts.id,
    household_id: facts.household_id,
    child_id: facts.child_id,
    kind: 'adjust',
    coins: facts.coins,
    money_amount: null,
    note: facts.note,
    ref_type: null,
    ref_id: null,
    created_at: facts.created_at,
    created_by: facts.created_by,
  };
}
