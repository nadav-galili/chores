import { describe, expect, it } from 'vitest';
import {
  adjustEntry,
  balanceOf,
  coinsToMoneyAmount,
  owedOf,
  payoutEntry,
  requestPayout,
  uuid5,
  type LedgerEntry,
} from './index.ts';

const household_id = uuid5('test', 'household');
const child_id = uuid5('test', 'child');
const parent_id = uuid5('test', 'parent');
const payout_id = uuid5('test', 'payout');
const adjust_id = uuid5('test', 'adjust');
const created_at = '2026-09-12T10:00:00.000Z';

const entry = (coins: number, money_amount: number | null = null): LedgerEntry => ({
  id: uuid5('test', String(coins), String(money_amount)),
  household_id,
  child_id,
  kind: 'earn',
  coins,
  money_amount,
  ref_type: 'completion',
  ref_id: uuid5('test', 'completion', String(coins)),
  created_at,
  created_by: child_id,
});

describe('money totals', () => {
  it('converts coins at coins_per_unit into minor currency units', () => {
    expect(coinsToMoneyAmount(25, 10)).toBe(250);
  });

  it('derives balance from every signed coin entry and owed from money amounts only', () => {
    const entries = [entry(100), entry(-25, 250), entry(5), entry(0, -50)];
    expect(balanceOf(entries)).toBe(80);
    expect(owedOf(entries)).toBe(200);
  });
});

describe('payout', () => {
  const facts = {
    id: payout_id,
    household_id,
    child_id,
    coins: 25,
    coins_per_unit: 10,
    created_at,
    created_by: parent_id,
  };

  it('uses its client uuid and spends coins while adding money owed', () => {
    expect(payoutEntry(facts)).toEqual({
      id: payout_id,
      household_id,
      child_id,
      kind: 'payout',
      coins: -25,
      money_amount: 250,
      note: null,
      ref_type: null,
      ref_id: null,
      created_at,
      created_by: parent_id,
    });
  });

  it('is refused when it asks for more coins than the balance', () => {
    expect(requestPayout({ ...facts, balance: 24 })).toEqual({
      ok: false,
      reason: 'insufficient_coins',
    });
  });

  it('may spend the exact balance', () => {
    expect(requestPayout({ ...facts, balance: 25 })).toEqual({
      ok: true,
      entry: payoutEntry(facts),
    });
  });
});

describe('adjustment', () => {
  it('uses its client uuid and carries either sign with its note', () => {
    const base = {
      id: adjust_id,
      household_id,
      child_id,
      created_at,
      created_by: parent_id,
      note: 'Corrected opening balance',
    };
    expect(adjustEntry({ ...base, coins: 15 })).toMatchObject({
      id: adjust_id,
      kind: 'adjust',
      coins: 15,
      money_amount: null,
      note: 'Corrected opening balance',
      ref_type: null,
      ref_id: null,
    });
    expect(adjustEntry({ ...base, coins: -8 }).coins).toBe(-8);
  });
});
