import { describe, expect, it } from 'vitest';
import {
  growthEntriesFor,
  growthEntrySchema,
  growthId,
  groveStage,
  treeForm,
  TREE_FORM_THRESHOLDS,
  TREE_MAX_FORM,
  type GrowthEntry,
} from './growth.ts';
import { reconcileLedger, type LedgerCompletion, type LedgerInstance } from './ledger.ts';
import { summarizeDays } from './day-summary.ts';
import { uuid5 } from './uuid5.ts';
import type { IsoDate } from './chore-date.ts';

const household = '9d0b8a7c-1111-4222-8333-444455556666';
const noa = 'aaaaaaaa-0000-4000-8000-000000000001';
const chore = 'cccccccc-0000-4000-8000-000000000001';
const device = 'dddddddd-0000-4000-8000-000000000001';
const at = '2026-09-09T15:00:00.000Z';
const redoCompletion = 'eeeeeeee-0000-4000-8000-000000000001';

const inst = (chore_date: IsoDate, n = 1): LedgerInstance => ({
  id: uuid5(chore, noa, chore_date, String(n)),
  chore_date,
});
const completion = (
  i: LedgerInstance,
  status: LedgerCompletion['status'] = 'accepted',
): LedgerCompletion => ({
  id: uuid5('completion', i.id),
  instance_id: i.id,
  chore_date: i.chore_date,
  status,
});

/** What the device and the server both do: append-only, `ON CONFLICT DO NOTHING`. */
function appendGrove(store: Map<string, GrowthEntry>, entries: readonly GrowthEntry[]) {
  for (const e of entries) if (!store.has(e.id)) store.set(e.id, e);
  return store;
}

function run(
  instances: readonly LedgerInstance[],
  completions: readonly LedgerCompletion[],
  streak_before = 0,
) {
  const out = reconcileLedger({
    household_id: household,
    child_id: noa,
    instances,
    completions,
    entries: [],
    created_at: at,
    created_by: device,
    streak_before,
  });
  return { ...out, grove: growthEntriesFor(household, noa, out.summaries, at) };
}

describe('growthEntrySchema', () => {
  it('parses a row the deterministic id produced', () => {
    const [entry] = growthEntriesFor(
      household,
      noa,
      summarizeDays(noa, [inst('2026-09-09')], [completion(inst('2026-09-09'))]),
      at,
    );
    expect(growthEntrySchema.parse(entry)).toEqual({
      id: growthId(noa, '2026-09-09'),
      household_id: household,
      child_id: noa,
      chore_date: '2026-09-09',
      created_at: at,
    });
  });

  it('rejects a chore_date that is not a household-local YYYY-MM-DD', () => {
    const row = {
      id: growthId(noa, '2026-09-09'),
      household_id: household,
      child_id: noa,
      chore_date: '2026-09-09',
      created_at: at,
    };
    expect(growthEntrySchema.safeParse(row).success).toBe(true);
    expect(
      growthEntrySchema.safeParse({ ...row, chore_date: '2026-09-09T00:00:00.000Z' }).success,
    ).toBe(false);
  });

  it('derives the id as uuid5("grow", child_id, chore_date)', () => {
    expect(growthId(noa, '2026-09-09')).toBe(uuid5('grow', noa, '2026-09-09'));
  });
});

describe('growth entries follow the day summary', () => {
  it('a day complete plants exactly one tree', () => {
    const a = inst('2026-09-09', 1);
    const b = inst('2026-09-09', 2);
    const out = run([a, b], [completion(a), completion(b)]);
    expect(out.summaries.map((s) => s.complete)).toEqual([true]);
    expect(out.grove.map((g) => g.id)).toEqual([growthId(noa, '2026-09-09')]);
  });

  it('a day that is not complete plants none', () => {
    const a = inst('2026-09-09', 1);
    const b = inst('2026-09-09', 2);
    const out = run([a, b], [completion(a)]);
    expect(out.summaries[0]!.complete).toBe(false);
    expect(out.grove).toEqual([]);
  });

  it('an undone tap leaves the day incomplete and plants nothing', () => {
    const a = inst('2026-09-09');
    const out = run([a], [completion(a, 'undone')]);
    expect(out.grove).toEqual([]);
  });

  it('a pending photo has not earned its tree yet', () => {
    const a = inst('2026-09-09');
    const out = run([a], [completion(a, 'pending_photo')]);
    expect(out.grove).toEqual([]);
  });
});

describe('frozen days', () => {
  it('a chore date with nothing due plants no tree and does not break the streak', () => {
    const mon = inst('2026-09-07');
    const wed = inst('2026-09-09');
    // Tuesday is frozen: no instance at all, so no summary row and no tree.
    const out = run([mon, wed], [completion(mon), completion(wed)]);
    expect(out.summaries.map((s) => s.chore_date)).toEqual(['2026-09-07', '2026-09-09']);
    expect(out.summaries.map((s) => s.streak_after)).toEqual([1, 2]);
    expect(out.grove.map((g) => g.chore_date)).toEqual(['2026-09-07', '2026-09-09']);
  });

  it('a summary row with nothing due plants nothing even though it carries the streak', () => {
    const frozen = {
      child_id: noa,
      chore_date: '2026-09-08' as IsoDate,
      due_count: 0,
      done_count: 0,
      complete: false,
      streak_after: 1,
    };
    expect(growthEntriesFor(household, noa, [frozen], at)).toEqual([]);
  });
});

describe('rejection', () => {
  const a = inst('2026-09-09');

  it('claws back coins and breaks the streak, but never reverses the tree', () => {
    const grown = run([a], [completion(a)], 4);
    const store = appendGrove(new Map(), grown.grove);
    expect(grown.summaries[0]!.streak_after).toBe(5);
    expect(store.size).toBe(1);

    // The parent rejects the completion; the same facts are reconciled again.
    const rejected = reconcileLedger({
      household_id: household,
      child_id: noa,
      instances: [a],
      completions: [completion(a, 'rejected')],
      entries: grown.entries,
      created_at: at,
      created_by: device,
      streak_before: 4,
    });
    const after = growthEntriesFor(household, noa, rejected.summaries, at);

    expect(rejected.entries.map((e) => e.kind)).toEqual(['clawback', 'clawback']);
    expect(rejected.entries.reduce((s, e) => s + e.coins, 0)).toBeLessThan(0);
    expect(rejected.summaries[0]!.streak_after).toBe(0);

    // No clawback counterpart exists to emit, and the standing tree is untouched.
    expect(after).toEqual([]);
    appendGrove(store, after);
    expect([...store.keys()]).toEqual([growthId(noa, '2026-09-09')]);
    expect(groveStage([...store.values()], noa)).toBe(1);
  });

  it('a redo after a rejection re-earns the coins without planting a second tree', () => {
    const store = appendGrove(new Map(), run([a], [completion(a)]).grove);
    const redo = run([a], [completion(a, 'rejected'), { ...completion(a), id: redoCompletion }]);
    expect(redo.summaries[0]!.complete).toBe(true);
    appendGrove(store, redo.grove);
    expect(store.size).toBe(1);
  });
});

describe('replay', () => {
  it('the same day complete applied twice yields one row', () => {
    const a = inst('2026-09-09');
    const store = new Map<string, GrowthEntry>();
    appendGrove(store, run([a], [completion(a)]).grove);
    appendGrove(store, run([a], [completion(a)]).grove);
    expect(store.size).toBe(1);
    expect(groveStage([...store.values()], noa)).toBe(1);
  });
});

describe('groveStage', () => {
  it('is the count of a child’s growth entries', () => {
    const days: IsoDate[] = ['2026-09-07', '2026-09-08', '2026-09-09'];
    const entries = days.map((d) => ({
      id: growthId(noa, d),
      household_id: household,
      child_id: noa,
      chore_date: d,
      created_at: at,
    }));
    expect(groveStage([], noa)).toBe(0);
    expect(groveStage(entries, noa)).toBe(3);
  });

  it('counts one child’s trees, not the household’s grove', () => {
    const ari = 'aaaaaaaa-0000-4000-8000-000000000002';
    const grove = [
      ...growthEntriesFor(household, noa, [summary(noa, '2026-09-08')], at),
      ...growthEntriesFor(household, noa, [summary(noa, '2026-09-09')], at),
      ...growthEntriesFor(household, ari, [summary(ari, '2026-09-09')], at),
    ];
    expect(groveStage(grove, noa)).toBe(2);
    expect(groveStage(grove, ari)).toBe(1);
  });
});

describe('treeForm', () => {
  /**
   * The ladder written out at, just below and just above each of the eight thresholds
   * (1 / 2 / 4 / 7 / 12 / 20 / 35 / 60), as literals rather than as a rule — the point of the
   * table is to be an oracle the implementation cannot agree with by sharing its logic.
   */
  it.each([
    [0, 1],
    [1, 1],
    [2, 2],
    [3, 2],
    [4, 3],
    [5, 3],
    [6, 3],
    [7, 4],
    [8, 4],
    [11, 4],
    [12, 5],
    [13, 5],
    [19, 5],
    [20, 6],
    [21, 6],
    [34, 6],
    [35, 7],
    [36, 7],
    [59, 7],
    [60, 8],
    [61, 8],
  ])('grove stage %i is tree form %i', (stage, form) => {
    expect(treeForm(stage)).toBe(form);
  });

  it('clamps at the eighth form however large the grove gets', () => {
    expect(treeForm(61)).toBe(8);
    expect(treeForm(400)).toBe(8);
    expect(treeForm(Number.MAX_SAFE_INTEGER)).toBe(8);
  });

  it('is still paying out in week three', () => {
    expect(treeForm(15)).toBeGreaterThan(treeForm(7));
    expect(treeForm(21)).toBeGreaterThan(treeForm(15));
  });

  it('is total: a stage off the happy path still yields a drawable form', () => {
    [-1, 0.5, 12.5, Number.NaN, Number.POSITIVE_INFINITY].forEach((stage) => {
      const form = treeForm(stage);
      expect(Number.isInteger(form)).toBe(true);
      expect(form).toBeGreaterThanOrEqual(1);
      expect(form).toBeLessThanOrEqual(TREE_MAX_FORM);
    });
  });

  it('the last threshold is the last form', () => {
    expect(TREE_FORM_THRESHOLDS).toHaveLength(TREE_MAX_FORM);
    expect(treeForm(TREE_FORM_THRESHOLDS[TREE_MAX_FORM - 1]!)).toBe(TREE_MAX_FORM);
  });

  it('is monotonic, whole and inside 1–8 for every stage', () => {
    let previous = 0;
    for (let stage = 0; stage <= 200; stage++) {
      const form = treeForm(stage);
      expect(Number.isInteger(form)).toBe(true);
      expect(form).toBeGreaterThanOrEqual(1);
      expect(form).toBeLessThanOrEqual(TREE_MAX_FORM);
      expect(form).toBeGreaterThanOrEqual(previous);
      previous = form;
    }
  });
});

/** A day-complete summary row for one child, the only kind that plants a tree. */
function summary(child_id: string, chore_date: IsoDate) {
  return { child_id, chore_date, due_count: 1, done_count: 1, complete: true, streak_after: 1 };
}
