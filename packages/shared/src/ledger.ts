import { z } from 'zod';
import type { IsoDate } from './chore-date.ts';
import {
  summarizeDays,
  type DaySummary,
  type SummarizeOptions,
  type SummaryCompletion,
  type SummaryInstance,
} from './day-summary.ts';
import { uuid5 } from './uuid5.ts';

// Reward rules (docs/spec/01-product.md). Fixed, not parent-tunable (ADR-0004).
export const COINS_PER_CHORE = 10;
export const DAY_COMPLETE_BONUS = 20;
export const STREAK_BONUS: Readonly<Record<number, number>> = { 3: 30, 7: 70, 14: 150 };
export const STREAK_MILESTONES = Object.keys(STREAK_BONUS).map(Number);

export const ledgerKindSchema = z.enum([
  'earn',
  'bonus',
  'streak',
  'clawback',
  'redeem',
  'payout',
  'adjust',
]);
export type LedgerKind = z.infer<typeof ledgerKindSchema>;

export const ledgerRefTypeSchema = z.enum(['completion', 'chore_date', 'ledger_entry']);
export type LedgerRefType = z.infer<typeof ledgerRefTypeSchema>;

export type LedgerEntry = {
  id: string;
  household_id: string;
  child_id: string;
  kind: LedgerKind;
  /** Signed. Balance is always SUM(coins); never stored. */
  coins: number;
  money_amount: number | null;
  ref_type: LedgerRefType;
  ref_id: string;
  created_at: string;
  created_by: string;
};

export type XpEvent = {
  id: string;
  child_id: string;
  xp: number;
  ref_entry_id: string;
  created_at: string;
};

export type LedgerInstance = SummaryInstance;
export type LedgerCompletion = SummaryCompletion & { id: string };

/** The slice of an existing entry the reconciliation reads. */
export type ExistingEntry = Pick<LedgerEntry, 'id' | 'kind' | 'coins'>;

export type ReconcileInput = SummarizeOptions & {
  household_id: string;
  child_id: string;
  /** Every instance of this child in the window under consideration. */
  instances: readonly LedgerInstance[];
  /** Every completion of this child for those instances, whatever its status. */
  completions: readonly LedgerCompletion[];
  /** Every earn/bonus/streak/clawback entry this child already has. */
  entries: readonly ExistingEntry[];
  /** Stamped on every row produced. */
  created_at: string;
  created_by: string;
};

export type ReconcileResult = {
  /** Rows to insert, in dependency order. Never touches existing rows. */
  entries: LedgerEntry[];
  /** One per entry, mirrored 1:1. */
  xp_events: XpEvent[];
  /** Recomputed summaries for every chore date with instances. */
  summaries: DaySummary[];
};

// Deterministic ids (docs/spec/02-data-model.md, ADR-0002, ADR-0010).
export const earnId = (completionId: string) => uuid5('earn', completionId);
export const bonusId = (childId: string, choreDate: IsoDate) => uuid5('bonus', childId, choreDate);
export const streakId = (childId: string, choreDate: IsoDate, n: number) =>
  uuid5('streak', childId, choreDate, String(n));
export const clawbackId = (targetEntryId: string) => uuid5('clawback', targetEntryId);
export const xpId = (ledgerEntryId: string) => uuid5('xp', ledgerEntryId);

type GrantKind = 'earn' | 'bonus' | 'streak';
const GRANT_KINDS: ReadonlySet<LedgerKind> = new Set<LedgerKind>(['earn', 'bonus', 'streak']);
type Grant = {
  id: string;
  kind: GrantKind;
  coins: number;
  ref_type: LedgerRefType;
  ref_id: string;
};

/**
 * The entries a child's facts imply but the ledger does not yet hold.
 *
 * Every grant (earn, bonus, streak) has a deterministic id and is written once. A grant that
 * the facts no longer justify is reversed by a clawback of exactly its value; a grant justified
 * again later (a redo after a rejection) is restored by a clawback of that clawback. Each
 * reversal targets the newest entry of the chain, so the ledger is only ever appended to,
 * the balance is a pure function of the facts, and re-running this on the same facts is a no-op.
 */
export function reconcileLedger(input: ReconcileInput): ReconcileResult {
  const summaries = summarizeDays(input.child_id, input.instances, input.completions, input);
  const expected = new Map<string, Grant>();
  for (const c of input.completions) {
    if (c.status !== 'accepted') continue;
    const id = earnId(c.id);
    expected.set(id, {
      id,
      kind: 'earn',
      coins: COINS_PER_CHORE,
      ref_type: 'completion',
      ref_id: c.id,
    });
  }
  for (const s of summaries) {
    if (!s.complete) continue;
    const bonus = bonusId(input.child_id, s.chore_date);
    expected.set(bonus, {
      id: bonus,
      kind: 'bonus',
      coins: DAY_COMPLETE_BONUS,
      ref_type: 'chore_date',
      ref_id: s.chore_date,
    });
    const streakCoins = STREAK_BONUS[s.streak_after];
    if (streakCoins !== undefined) {
      const id = streakId(input.child_id, s.chore_date, s.streak_after);
      expected.set(id, {
        id,
        kind: 'streak',
        coins: streakCoins,
        ref_type: 'chore_date',
        ref_id: s.chore_date,
      });
    }
  }

  const coinsById = new Map(input.entries.map((e) => [e.id, e.coins]));
  const entries: LedgerEntry[] = [];
  const emit = (e: Pick<LedgerEntry, 'id' | 'kind' | 'coins' | 'ref_type' | 'ref_id'>) => {
    entries.push({
      household_id: input.household_id,
      child_id: input.child_id,
      money_amount: null,
      created_at: input.created_at,
      created_by: input.created_by,
      ...e,
    });
    coinsById.set(e.id, e.coins);
  };
  const reverse = (grantId: string) => {
    let id = grantId;
    while (coinsById.has(clawbackId(id))) id = clawbackId(id);
    emit({
      id: clawbackId(id),
      kind: 'clawback',
      coins: -coinsById.get(id)!,
      ref_type: 'ledger_entry',
      ref_id: id,
    });
  };
  const active = (grantId: string) => {
    let id = grantId;
    while (coinsById.has(clawbackId(id))) id = clawbackId(id);
    return coinsById.get(id)! > 0;
  };

  // Grants the facts justify: write the grant if new, or restore it if it was clawed back.
  for (const g of expected.values()) {
    if (!coinsById.has(g.id)) emit(g);
    else if (!active(g.id)) reverse(g.id);
  }
  // Grants the ledger holds that the facts no longer justify: reverse them.
  for (const held of input.entries) {
    if (GRANT_KINDS.has(held.kind) && !expected.has(held.id) && active(held.id)) reverse(held.id);
  }

  const xp_events = entries.map((e) => ({
    id: xpId(e.id),
    child_id: e.child_id,
    xp: e.coins,
    ref_entry_id: e.id,
    created_at: e.created_at,
  }));
  return { entries, xp_events, summaries };
}
