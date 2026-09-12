import { describe, expect, it } from 'vitest';
import {
  clawbackId,
  reconcileLedger,
  redeemEntry,
  redeemEntryId,
  redemptionRefundId,
  refundEntry,
  requestRedemption,
  uuid5,
  type ExistingEntry,
  type LedgerEntry,
} from './index.ts';

const household_id = uuid5('test', 'household');
const child_id = uuid5('test', 'child');
const redemption_id = uuid5('test', 'redemption');
const parent_id = uuid5('test', 'parent');

const facts = {
  household_id,
  child_id,
  redemption_id,
  cost_coins: 150,
  created_at: '2026-09-09T10:00:00.000Z',
  created_by: child_id,
};

/** An append-only ledger: an entry whose id is already there changes nothing. */
function append(entries: readonly LedgerEntry[]): LedgerEntry[] {
  const byId = new Map<string, LedgerEntry>();
  for (const e of entries) if (!byId.has(e.id)) byId.set(e.id, e);
  return [...byId.values()];
}

const balanceOf = (entries: readonly LedgerEntry[]) => entries.reduce((n, e) => n + e.coins, 0);

describe('the request', () => {
  it('writes one `redeem` entry at −cost, against the redemption', () => {
    expect(redeemEntry(facts)).toEqual({
      id: redeemEntryId(redemption_id),
      household_id,
      child_id,
      kind: 'redeem',
      coins: -150,
      money_amount: null,
      ref_type: 'redemption',
      ref_id: redemption_id,
      created_at: facts.created_at,
      created_by: child_id,
    });
  });

  it('derives the entry id from the redemption alone', () => {
    expect(redeemEntryId(redemption_id)).toBe(uuid5('redeem', redemption_id));
  });

  it('is refused when the balance would go negative, and writes nothing', () => {
    expect(requestRedemption({ ...facts, balance: 149 })).toEqual({
      ok: false,
      reason: 'insufficient_coins',
    });
  });

  it('is allowed when the balance covers it exactly, leaving zero', () => {
    const result = requestRedemption({ ...facts, balance: 150 });
    expect(result).toEqual({ ok: true, entry: redeemEntry(facts) });
    expect(150 + (result.ok ? result.entry.coins : 0)).toBe(0);
  });
});

describe('the refund', () => {
  it('is a clawback of the redeem entry at +cost', () => {
    expect(refundEntry(facts)).toEqual({
      id: clawbackId(redeemEntryId(redemption_id)),
      household_id,
      child_id,
      kind: 'clawback',
      coins: 150,
      money_amount: null,
      ref_type: 'ledger_entry',
      ref_id: redeemEntryId(redemption_id),
      created_at: facts.created_at,
      created_by: child_id,
    });
  });

  it('has the same id whether the parent declined or the child cancelled', () => {
    const declined = refundEntry({
      ...facts,
      created_by: parent_id,
      created_at: '2026-09-09T10:00:01.000Z',
    });
    const cancelled = refundEntry(facts);
    expect(declined.id).toBe(cancelled.id);
    expect(declined.id).toBe(redemptionRefundId(redemption_id));
    expect(declined.coins).toBe(cancelled.coins);
  });
});

describe('request, then cancel and decline in any order', () => {
  const cancel = () => refundEntry(facts);
  const decline = () =>
    refundEntry({ ...facts, created_by: parent_id, created_at: '2026-09-09T10:00:01.000Z' });

  const orders: [string, () => LedgerEntry[]][] = [
    ['cancel then decline', () => [redeemEntry(facts), cancel(), decline()]],
    ['decline then cancel', () => [redeemEntry(facts), decline(), cancel()]],
    ['decline twice', () => [redeemEntry(facts), decline(), decline()]],
    ['cancel twice', () => [redeemEntry(facts), cancel(), cancel()]],
  ];

  for (const [name, write] of orders) {
    it(`${name} leaves exactly one refund and a balance back where it started`, () => {
      const ledger = append(write());
      const refunds = ledger.filter((e) => e.id === redemptionRefundId(redemption_id));
      expect(refunds).toHaveLength(1);
      expect(ledger).toHaveLength(2);
      expect(balanceOf(ledger)).toBe(0);
    });
  }

  it('leaves the coins gone while the request is still open', () => {
    expect(balanceOf(append([redeemEntry(facts)]))).toBe(-150);
  });
});

describe('approval', () => {
  it('writes nothing: the coins already left at request time', () => {
    // There is no `approveEntry`, deliberately — approval is permission, not an accounting event
    // (ADR-0014). The whole of what approval does to the ledger is this assertion.
    const ledger = append([redeemEntry(facts)]);
    expect(ledger).toHaveLength(1);
    expect(balanceOf(ledger)).toBe(-150);
  });
});

describe('reconciliation', () => {
  const entries = (ledger: readonly LedgerEntry[]): ExistingEntry[] =>
    ledger.map((e) => ({ id: e.id, kind: e.kind, coins: e.coins }));

  const reconcile = (ledger: readonly LedgerEntry[]) =>
    reconcileLedger({
      household_id,
      child_id,
      instances: [],
      completions: [],
      // The server reads earn/bonus/streak/clawback, so the refund is in what it sees.
      entries: entries(ledger).filter((e) => e.kind !== 'redeem'),
      created_at: facts.created_at,
      created_by: child_id,
    });

  it('never reverses a redeem, and never re-refunds one', () => {
    expect(reconcile([redeemEntry(facts)]).entries).toEqual([]);
    expect(reconcile([redeemEntry(facts), refundEntry(facts)]).entries).toEqual([]);
  });
});
