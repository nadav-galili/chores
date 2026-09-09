import { describe, expect, it } from 'vitest';
import {
  currentStreak,
  summarizeDays,
  type SummaryCompletion,
  type SummaryInstance,
} from './day-summary.ts';

const noa = 'aaaaaaaa-0000-4000-8000-000000000001';

let n = 0;
const inst = (chore_date: string): SummaryInstance => ({ id: `i${++n}`, chore_date });
const done = (
  i: SummaryInstance,
  status: SummaryCompletion['status'] = 'accepted',
): SummaryCompletion => ({
  instance_id: i.id,
  chore_date: i.chore_date,
  status,
});

describe('summarizeDays', () => {
  it('counts due and done and marks a day complete only when every due instance is done', () => {
    const a = inst('2026-09-09');
    const b = inst('2026-09-09');
    expect(summarizeDays(noa, [a, b], [done(a)])).toEqual([
      {
        child_id: noa,
        chore_date: '2026-09-09',
        due_count: 2,
        done_count: 1,
        complete: false,
        streak_after: 0,
      },
    ]);
    expect(summarizeDays(noa, [a, b], [done(a), done(b)])).toEqual([
      {
        child_id: noa,
        chore_date: '2026-09-09',
        due_count: 2,
        done_count: 2,
        complete: true,
        streak_after: 1,
      },
    ]);
  });

  it('ignores rejected and pending-photo completions and counts an instance once', () => {
    const a = inst('2026-09-09');
    const out = summarizeDays(noa, [a], [done(a, 'rejected'), done(a, 'pending_photo')]);
    expect(out[0]).toMatchObject({ due_count: 1, done_count: 0, complete: false });
    const twice = summarizeDays(noa, [a], [done(a, 'rejected'), done(a), done(a)]);
    expect(twice[0]).toMatchObject({ done_count: 1, complete: true });
  });

  it('walks the streak forward: complete extends, zero-due freezes, incomplete breaks', () => {
    const d1 = inst('2026-09-01');
    const d2 = inst('2026-09-02');
    const d4 = inst('2026-09-04');
    const d5 = inst('2026-09-05');
    const out = summarizeDays(noa, [d1, d2, d4, d5], [done(d1), done(d2), done(d5)]);
    expect(out.map((s) => [s.chore_date, s.streak_after])).toEqual([
      ['2026-09-01', 1],
      ['2026-09-02', 2],
      ['2026-09-04', 0],
      ['2026-09-05', 1],
    ]);
  });

  it('a date with instances that were all rejected is a due day with zero done, not a frozen day', () => {
    const d1 = inst('2026-09-01');
    const d2 = inst('2026-09-02');
    const d3 = inst('2026-09-03');
    const out = summarizeDays(noa, [d1, d2, d3], [done(d1), done(d2, 'rejected'), done(d3)]);
    expect(out.map((s) => s.streak_after)).toEqual([1, 0, 1]);
  });

  it('continues from a carried-in streak and sorts unordered input by date', () => {
    const d2 = inst('2026-09-02');
    const d1 = inst('2026-09-01');
    const out = summarizeDays(noa, [d2, d1], [done(d1), done(d2)], { streak_before: 5 });
    expect(out.map((s) => [s.chore_date, s.streak_after])).toEqual([
      ['2026-09-01', 6],
      ['2026-09-02', 7],
    ]);
  });
});

describe('currentStreak', () => {
  it('is today’s streak when today is complete, otherwise the streak carried into today', () => {
    const d1 = inst('2026-09-01');
    const d2 = inst('2026-09-02');
    const summaries = summarizeDays(noa, [d1, d2], [done(d1)]);
    expect(currentStreak(summaries, '2026-09-02')).toBe(1);
    expect(currentStreak(summarizeDays(noa, [d1, d2], [done(d1), done(d2)]), '2026-09-02')).toBe(2);
  });

  it('is zero after a broken day before today, and the last streak across frozen days', () => {
    const d1 = inst('2026-09-01');
    const d2 = inst('2026-09-02');
    expect(currentStreak(summarizeDays(noa, [d1, d2], [done(d1)]), '2026-09-03')).toBe(0);
    expect(currentStreak(summarizeDays(noa, [d1], [done(d1)]), '2026-09-05')).toBe(1);
    expect(currentStreak([], '2026-09-05')).toBe(0);
  });
});
