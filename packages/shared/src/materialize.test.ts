import { describe, expect, it } from 'vitest';
import { materializeInstances, weekdayOf, type MaterializableChore } from './materialize.ts';
import { uuid5 } from './uuid5.ts';

const household = '9d0b8a7c-1111-4222-8333-444455556666';
const noa = 'aaaaaaaa-0000-4000-8000-000000000001';
const ido = 'aaaaaaaa-0000-4000-8000-000000000002';

const daily: MaterializableChore = {
  id: 'cccccccc-0000-4000-8000-000000000001',
  household_id: household,
  kind: 'daily',
  weekday_mask: null,
  start_date: null,
  end_date: null,
  due_date: null,
  deleted_at: null,
  assignees: [noa],
};

describe('weekdayOf', () => {
  it('uses Mon=0 … Sun=6 on the local date', () => {
    expect(weekdayOf('2026-09-07')).toBe(0); // Monday
    expect(weekdayOf('2026-09-09')).toBe(2); // Wednesday
    expect(weekdayOf('2026-09-13')).toBe(6); // Sunday
  });
});

describe('materializeInstances', () => {
  it('gives a daily chore one due instance per assignee with a deterministic id', () => {
    const out = materializeInstances([{ ...daily, assignees: [noa, ido] }], '2026-09-09');
    expect(out).toEqual([
      {
        id: uuid5(daily.id, noa, '2026-09-09'),
        chore_id: daily.id,
        child_id: noa,
        household_id: household,
        chore_date: '2026-09-09',
        status: 'due',
      },
      {
        id: uuid5(daily.id, ido, '2026-09-09'),
        chore_id: daily.id,
        child_id: ido,
        household_id: household,
        chore_date: '2026-09-09',
        status: 'due',
      },
    ]);
  });

  it('produces the same id for the same chore, child and chore date', () => {
    const [a] = materializeInstances([daily], '2026-09-09');
    const [b] = materializeInstances([daily], '2026-09-09');
    expect(a?.id).toBe(b?.id);
    expect(materializeInstances([daily], '2026-09-10')[0]?.id).not.toBe(a?.id);
  });

  it('skips deleted chores', () => {
    expect(
      materializeInstances([{ ...daily, deleted_at: '2026-09-01T10:00:00.000Z' }], '2026-09-09'),
    ).toEqual([]);
  });

  it('respects start and end dates inclusively', () => {
    const windowed = { ...daily, start_date: '2026-09-08', end_date: '2026-09-10' };
    expect(materializeInstances([windowed], '2026-09-07')).toHaveLength(0);
    expect(materializeInstances([windowed], '2026-09-08')).toHaveLength(1);
    expect(materializeInstances([windowed], '2026-09-10')).toHaveLength(1);
    expect(materializeInstances([windowed], '2026-09-11')).toHaveLength(0);
  });

  it('materializes a once chore only on its due date', () => {
    const once = { ...daily, kind: 'once' as const, due_date: '2026-09-12' };
    expect(materializeInstances([once], '2026-09-11')).toHaveLength(0);
    expect(materializeInstances([once], '2026-09-12')).toHaveLength(1);
    expect(materializeInstances([once], '2026-09-13')).toHaveLength(0);
  });

  it('materializes a weekdays chore only on days set in the mask (Mon=0 … Sun=6)', () => {
    const monWedFri = { ...daily, kind: 'weekdays' as const, weekday_mask: 0b0010101 };
    expect(materializeInstances([monWedFri], '2026-09-07')).toHaveLength(1); // Mon
    expect(materializeInstances([monWedFri], '2026-09-08')).toHaveLength(0); // Tue
    expect(materializeInstances([monWedFri], '2026-09-09')).toHaveLength(1); // Wed
    expect(materializeInstances([monWedFri], '2026-09-11')).toHaveLength(1); // Fri
    expect(materializeInstances([monWedFri], '2026-09-13')).toHaveLength(0); // Sun
    const sunOnly = { ...monWedFri, weekday_mask: 0b1000000 };
    expect(materializeInstances([sunOnly], '2026-09-13')).toHaveLength(1);
  });

  it('applies the start/end window to weekdays chores too', () => {
    const wed = {
      ...daily,
      kind: 'weekdays' as const,
      weekday_mask: 0b0000100,
      end_date: '2026-09-09',
    };
    expect(materializeInstances([wed], '2026-09-09')).toHaveLength(1);
    expect(materializeInstances([wed], '2026-09-16')).toHaveLength(0);
  });

  it('a chore with no assignees yields nothing', () => {
    expect(materializeInstances([{ ...daily, assignees: [] }], '2026-09-09')).toEqual([]);
  });

  it('flattens across several chores', () => {
    const other = { ...daily, id: 'cccccccc-0000-4000-8000-000000000002', assignees: [ido] };
    const out = materializeInstances([daily, other], '2026-09-09');
    expect(out.map((i) => [i.chore_id, i.child_id])).toEqual([
      [daily.id, noa],
      [other.id, ido],
    ]);
  });
});
