import { describe, expect, it } from 'vitest';
import {
  COINS_PER_CHORE,
  DAY_COMPLETE_BONUS,
  STREAK_BONUS,
  reconcileLedger,
  type LedgerCompletion,
  type LedgerEntry,
  type LedgerInstance,
  type ReconcileInput,
} from './ledger.ts';
import { uuid5 } from './uuid5.ts';

const household = '9d0b8a7c-1111-4222-8333-444455556666';
const noa = 'aaaaaaaa-0000-4000-8000-000000000001';
const chore = 'cccccccc-0000-4000-8000-000000000001';
const at = '2026-09-09T15:00:00.000Z';
const device = 'dddddddd-0000-4000-8000-000000000001';

let seq = 0;
const inst = (chore_date: string): LedgerInstance => ({
  id: uuid5(chore, noa, chore_date) + `#${++seq}`,
  chore_date,
});
const completion = (
  i: LedgerInstance,
  status: LedgerCompletion['status'] = 'accepted',
): LedgerCompletion => ({
  id: `completion-${++seq}`,
  instance_id: i.id,
  chore_date: i.chore_date,
  status,
});

function reconcile(partial: Partial<ReconcileInput>) {
  return reconcileLedger({
    household_id: household,
    child_id: noa,
    instances: [],
    completions: [],
    entries: [],
    created_at: at,
    created_by: device,
    ...partial,
  });
}

const sum = (entries: readonly LedgerEntry[]) => entries.reduce((s, e) => s + e.coins, 0);

describe('reconcileLedger: completion', () => {
  it('pays an earn entry and its XP event with deterministic ids', () => {
    const a = inst('2026-09-09');
    const b = inst('2026-09-09');
    const c = completion(a);
    const out = reconcile({ instances: [a, b], completions: [c] });
    expect(out.entries).toEqual([
      {
        id: uuid5('earn', c.id),
        household_id: household,
        child_id: noa,
        kind: 'earn',
        coins: COINS_PER_CHORE,
        money_amount: null,
        ref_type: 'completion',
        ref_id: c.id,
        created_at: at,
        created_by: device,
      },
    ]);
    expect(out.xp_events).toEqual([
      {
        id: uuid5('xp', uuid5('earn', c.id)),
        child_id: noa,
        xp: 10,
        ref_entry_id: uuid5('earn', c.id),
        created_at: at,
      },
    ]);
    expect(out.summaries).toEqual([
      {
        child_id: noa,
        chore_date: '2026-09-09',
        due_count: 2,
        done_count: 1,
        complete: false,
        streak_after: 0,
      },
    ]);
  });

  it('pays nothing for pending-photo or rejected completions', () => {
    const a = inst('2026-09-09');
    const out = reconcile({ instances: [a], completions: [completion(a, 'pending_photo')] });
    expect(out.entries).toEqual([]);
    expect(out.xp_events).toEqual([]);
  });

  it('adds the day-complete bonus when the last due instance is done', () => {
    const a = inst('2026-09-09');
    const c = completion(a);
    const out = reconcile({ instances: [a], completions: [c] });
    expect(out.entries.map((e) => [e.kind, e.coins, e.id])).toEqual([
      ['earn', 10, uuid5('earn', c.id)],
      ['bonus', DAY_COMPLETE_BONUS, uuid5('bonus', noa, '2026-09-09')],
    ]);
    expect(out.entries[1]).toMatchObject({ ref_type: 'chore_date', ref_id: '2026-09-09' });
    expect(out.xp_events.map((x) => x.xp)).toEqual([10, 20]);
  });

  it('pays streak bonuses on day 3, 7 and 14 only', () => {
    const days = Array.from({ length: 15 }, (_, i) =>
      inst(`2026-09-${String(i + 1).padStart(2, '0')}`),
    );
    const out = reconcile({ instances: days, completions: days.map((d) => completion(d)) });
    const streaks = out.entries.filter((e) => e.kind === 'streak');
    expect(streaks.map((e) => [e.ref_id, e.coins, e.id])).toEqual([
      ['2026-09-03', STREAK_BONUS[3], uuid5('streak', noa, '2026-09-03', '3')],
      ['2026-09-07', STREAK_BONUS[7], uuid5('streak', noa, '2026-09-07', '7')],
      ['2026-09-14', STREAK_BONUS[14], uuid5('streak', noa, '2026-09-14', '14')],
    ]);
    expect(sum(out.entries)).toBe(15 * 10 + 15 * 20 + 30 + 70 + 150);
  });

  it('is a no-op when every entry it would produce already exists', () => {
    const a = inst('2026-09-09');
    const c = completion(a);
    const first = reconcile({ instances: [a], completions: [c] });
    const again = reconcile({ instances: [a], completions: [c], entries: first.entries });
    expect(again.entries).toEqual([]);
    expect(again.xp_events).toEqual([]);
  });
});

describe('reconcileLedger: rejection', () => {
  it('earn → reject nets to zero through a clawback of the earn', () => {
    const a = inst('2026-09-09');
    const b = inst('2026-09-09');
    const c = completion(a);
    const paid = reconcile({ instances: [a, b], completions: [c] });
    const out = reconcile({
      instances: [a, b],
      completions: [{ ...c, status: 'rejected' }],
      entries: paid.entries,
    });
    expect(out.entries).toEqual([
      {
        id: uuid5('clawback', uuid5('earn', c.id)),
        household_id: household,
        child_id: noa,
        kind: 'clawback',
        coins: -10,
        money_amount: null,
        ref_type: 'ledger_entry',
        ref_id: uuid5('earn', c.id),
        created_at: at,
        created_by: device,
      },
    ]);
    expect(out.xp_events).toEqual([
      {
        id: uuid5('xp', out.entries[0]!.id),
        child_id: noa,
        xp: -10,
        ref_entry_id: out.entries[0]!.id,
        created_at: at,
      },
    ]);
    expect(sum([...paid.entries, ...out.entries])).toBe(0);
  });

  it('a rejection that breaks day complete claws back the bonus and the streak bonus it triggered', () => {
    const days = ['2026-09-01', '2026-09-02', '2026-09-03'].map(inst);
    const completions = days.map((d) => completion(d));
    const paid = reconcile({ instances: days, completions });
    expect(sum(paid.entries)).toBe(30 + 60 + 30);
    const rejected = completions.map((c, i) =>
      i === 2 ? { ...c, status: 'rejected' as const } : c,
    );
    const out = reconcile({ instances: days, completions: rejected, entries: paid.entries });
    expect(out.entries.map((e) => [e.kind, e.coins, e.ref_id])).toEqual([
      ['clawback', -10, uuid5('earn', completions[2]!.id)],
      ['clawback', -20, uuid5('bonus', noa, '2026-09-03')],
      ['clawback', -30, uuid5('streak', noa, '2026-09-03', '3')],
    ]);
    expect(sum([...paid.entries, ...out.entries])).toBe(20 + 40);
    expect(out.summaries[2]).toMatchObject({ complete: false, streak_after: 0 });
  });

  it('rejecting an earlier day also claws back a later streak bonus that day made possible', () => {
    const days = ['2026-09-01', '2026-09-02', '2026-09-03'].map(inst);
    const completions = days.map((d) => completion(d));
    const paid = reconcile({ instances: days, completions });
    const rejected = completions.map((c, i) =>
      i === 0 ? { ...c, status: 'rejected' as const } : c,
    );
    const out = reconcile({ instances: days, completions: rejected, entries: paid.entries });
    expect(out.entries.map((e) => [e.coins, e.ref_id])).toEqual([
      [-10, uuid5('earn', completions[0]!.id)],
      [-20, uuid5('bonus', noa, '2026-09-01')],
      [-30, uuid5('streak', noa, '2026-09-03', '3')],
    ]);
  });

  it('a redo after a rejection restores the bonus by reversing its clawback, and a second rejection claws it back again', () => {
    const a = inst('2026-09-09');
    const c1 = completion(a);
    const s1 = reconcile({ instances: [a], completions: [c1] });
    const s2 = reconcile({
      instances: [a],
      completions: [{ ...c1, status: 'rejected' }],
      entries: s1.entries,
    });
    const c2 = completion(a);
    const entries2 = [...s1.entries, ...s2.entries];
    const s3 = reconcile({
      instances: [a],
      completions: [{ ...c1, status: 'rejected' }, c2],
      entries: entries2,
    });
    const bonus = uuid5('bonus', noa, '2026-09-09');
    expect(s3.entries.map((e) => [e.kind, e.coins, e.id, e.ref_id])).toEqual([
      ['earn', 10, uuid5('earn', c2.id), c2.id],
      ['clawback', 20, uuid5('clawback', uuid5('clawback', bonus)), uuid5('clawback', bonus)],
    ]);
    const entries3 = [...entries2, ...s3.entries];
    expect(sum(entries3)).toBe(30);
    const s4 = reconcile({
      instances: [a],
      completions: [
        { ...c1, status: 'rejected' },
        { ...c2, status: 'rejected' },
      ],
      entries: entries3,
    });
    expect(s4.entries.map((e) => [e.coins, e.id]).sort()).toEqual(
      [
        [-10, uuid5('clawback', uuid5('earn', c2.id))],
        [-20, uuid5('clawback', uuid5('clawback', uuid5('clawback', bonus)))],
      ].sort(),
    );
    expect(sum([...entries3, ...s4.entries])).toBe(0);
  });

  it('re-applying a rejection is a no-op', () => {
    const a = inst('2026-09-09');
    const c = completion(a);
    const paid = reconcile({ instances: [a], completions: [c] });
    const rejected = [{ ...c, status: 'rejected' as const }];
    const clawed = reconcile({ instances: [a], completions: rejected, entries: paid.entries });
    const again = reconcile({
      instances: [a],
      completions: rejected,
      entries: [...paid.entries, ...clawed.entries],
    });
    expect(again.entries).toEqual([]);
  });
});

/** Tiny deterministic PRNG so failures reproduce from the seed. */
function mulberry32(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Op =
  { kind: 'complete'; completion: LedgerCompletion } | { kind: 'reject'; completion_id: string };

/** A random valid history: completions on due/redo instances, rejections of accepted completions. */
function randomOps(rand: () => number, instances: LedgerInstance[]): Op[] {
  const ops: Op[] = [];
  const open = new Map<string, string>(); // instance id → accepted completion id
  let k = 0;
  const count = 1 + Math.floor(rand() * 40);
  for (let i = 0; i < count; i++) {
    const rejectable = [...open.entries()];
    if (rejectable.length > 0 && rand() < 0.35) {
      const [instanceId, completionId] = rejectable[Math.floor(rand() * rejectable.length)]!;
      open.delete(instanceId);
      ops.push({ kind: 'reject', completion_id: completionId });
      continue;
    }
    const free = instances.filter((x) => !open.has(x.id));
    if (free.length === 0) continue;
    const target = free[Math.floor(rand() * free.length)]!;
    const completion: LedgerCompletion = {
      id: `c${++k}`,
      instance_id: target.id,
      chore_date: target.chore_date,
      status: 'accepted',
    };
    open.set(target.id, completion.id);
    ops.push({ kind: 'complete', completion });
  }
  return ops;
}

/** Apply ops one at a time, reconciling after each, the way a device or the server does. */
function play(
  ops: readonly Op[],
  instances: LedgerInstance[],
  start: { entries: LedgerEntry[]; completions: LedgerCompletion[] } = {
    entries: [],
    completions: [],
  },
) {
  const completions = new Map(start.completions.map((c) => [c.id, c]));
  let entries = start.entries;
  for (const op of ops) {
    // An op already applied is a no-op (the server's applied_ops, the device's outbox ack).
    if (op.kind === 'complete') {
      if (!completions.has(op.completion.id)) completions.set(op.completion.id, op.completion);
    } else {
      const c = completions.get(op.completion_id);
      if (c) completions.set(c.id, { ...c, status: 'rejected' });
    }
    const out = reconcile({ instances, completions: [...completions.values()], entries });
    entries = [...entries, ...out.entries];
  }
  return { entries, completions: [...completions.values()] };
}

function shuffle<T>(rand: () => number, items: readonly T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/** A reordering of a history that keeps every rejection after its completion. */
function causalShuffle(rand: () => number, ops: readonly Op[]): Op[] {
  const out: Op[] = [];
  const seen = new Set<string>();
  const pending = shuffle(rand, ops);
  while (pending.length > 0) {
    const i = pending.findIndex((op) => op.kind === 'complete' || seen.has(op.completion_id));
    const [op] = pending.splice(i, 1);
    if (op!.kind === 'complete') seen.add(op!.completion.id);
    out.push(op!);
  }
  return out;
}

describe('reconcileLedger: properties', () => {
  const instances = ['2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04', '2026-09-05'].flatMap(
    (d) => [
      { id: `${d}/a`, chore_date: d },
      { id: `${d}/b`, chore_date: d },
    ],
  );

  it('the balance is a function of the facts alone, whatever history produced them', () => {
    for (let seed = 1; seed <= 300; seed++) {
      const rand = mulberry32(seed);
      const ops = randomOps(rand, instances);
      const { entries, completions } = play(ops, instances);
      const fresh = reconcile({ instances, completions });
      expect(sum(entries), `seed ${seed}`).toBe(sum(fresh.entries));
      expect(new Set(entries.map((e) => e.id)).size, `seed ${seed}: duplicate ids`).toBe(
        entries.length,
      );
    }
  });

  it('any causal ordering of the same history yields the same ledger sum', () => {
    for (let seed = 1; seed <= 300; seed++) {
      const rand = mulberry32(seed);
      const ops = randomOps(rand, instances);
      const expected = sum(play(ops, instances).entries);
      expect(sum(play(causalShuffle(rand, ops), instances).entries), `seed ${seed}`).toBe(expected);
    }
  });

  it('re-applying the whole history again, shuffled and with duplicates, changes nothing', () => {
    for (let seed = 1; seed <= 300; seed++) {
      const rand = mulberry32(seed);
      const ops = randomOps(rand, instances);
      const done = play(ops, instances);
      const replay = shuffle(rand, [...ops, ...ops]);
      const after = play(replay, instances, done);
      const { entries } = done;
      expect(after.entries.length, `seed ${seed}`).toBe(entries.length);
      expect(sum(after.entries), `seed ${seed}`).toBe(sum(entries));
    }
  });
});
