import { describe, expect, it } from 'vitest';
import { applyChoreOp, choreFieldsSchema, upsertChoreOpSchema } from './chore.ts';

const noa = '0190f0a0-0000-7000-8000-000000000001';
const ori = '0190f0a0-0000-7000-8000-000000000002';

const dishes = {
  title: 'Dishes',
  icon: null,
  kind: 'daily' as const,
  weekday_mask: null,
  start_date: null,
  end_date: null,
  due_date: null,
  requires_photo: false,
  assignees: [noa],
} satisfies Record<string, unknown>;

describe('choreFieldsSchema', () => {
  it('accepts a daily chore with one assignee', () => {
    expect(choreFieldsSchema.safeParse(dishes).success).toBe(true);
  });

  it('rejects a weekdays chore with an empty mask', () => {
    const r = choreFieldsSchema.safeParse({ ...dishes, kind: 'weekdays', weekday_mask: 0 });
    expect(r.success).toBe(false);
    const r2 = choreFieldsSchema.safeParse({ ...dishes, kind: 'weekdays', weekday_mask: null });
    expect(r2.success).toBe(false);
  });

  it('accepts a weekdays chore with Mon+Wed and rejects a mask beyond 7 bits', () => {
    expect(
      choreFieldsSchema.safeParse({ ...dishes, kind: 'weekdays', weekday_mask: 0b101 }).success,
    ).toBe(true);
    expect(
      choreFieldsSchema.safeParse({ ...dishes, kind: 'weekdays', weekday_mask: 128 }).success,
    ).toBe(false);
  });

  it('requires a due date for a once chore', () => {
    expect(choreFieldsSchema.safeParse({ ...dishes, kind: 'once' }).success).toBe(false);
    expect(
      choreFieldsSchema.safeParse({ ...dishes, kind: 'once', due_date: '2026-09-12' }).success,
    ).toBe(true);
  });

  it('requires at least one assignee and a non-blank title', () => {
    expect(choreFieldsSchema.safeParse({ ...dishes, assignees: [] }).success).toBe(false);
    expect(choreFieldsSchema.safeParse({ ...dishes, title: '  ' }).success).toBe(false);
  });

  it('rejects an end date before the start date', () => {
    expect(
      choreFieldsSchema.safeParse({ ...dishes, start_date: '2026-09-10', end_date: '2026-09-09' })
        .success,
    ).toBe(false);
  });
});

describe('applyChoreOp', () => {
  const t1 = '2026-09-09T10:00:00.000Z';
  const t2 = '2026-09-09T11:00:00.000Z';

  it('creates a chore from a full op when there is no current row', () => {
    const op = upsertChoreOpSchema.parse({ fields: dishes, updated_at: t1 });
    const r = applyChoreOp(null, op);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.fields).toEqual(dishes);
    expect(r.clocks.title).toBe(t1);
    expect(r.clocks.assignees).toBe(t1);
  });

  it('rejects a partial op when there is no current row', () => {
    const op = upsertChoreOpSchema.parse({ fields: { title: 'Dishes' }, updated_at: t1 });
    expect(applyChoreOp(null, op).ok).toBe(false);
  });

  it('two parents editing different fields both land, whatever the arrival order', () => {
    const created = applyChoreOp(null, { fields: dishes, updated_at: t1 });
    if (!created.ok) throw new Error('setup');
    // Parent B's later edit to assignees arrives first.
    const afterB = applyChoreOp(created, { fields: { assignees: [noa, ori] }, updated_at: t2 });
    if (!afterB.ok) throw new Error('setup');
    // Parent A's earlier edit to the title arrives second; the title was never touched after t1.
    const afterA = applyChoreOp(afterB, { fields: { title: 'Wash dishes' }, updated_at: t1 });
    expect(afterA.ok).toBe(true);
    if (!afterA.ok) return;
    expect(afterA.fields.title).toBe('Wash dishes');
    expect(afterA.fields.assignees).toEqual([noa, ori]);
    expect(afterA.changed).toEqual(['title']);
  });

  it('on the same field the later writer wins, whatever the arrival order', () => {
    const created = applyChoreOp(null, { fields: dishes, updated_at: t1 });
    if (!created.ok) throw new Error('setup');
    const later = applyChoreOp(created, { fields: { title: 'Later' }, updated_at: t2 });
    if (!later.ok) throw new Error('setup');
    const stale = applyChoreOp(later, { fields: { title: 'Earlier' }, updated_at: t1 });
    expect(stale.ok).toBe(true);
    if (!stale.ok) return;
    expect(stale.fields.title).toBe('Later');
    expect(stale.changed).toEqual([]);
    expect(stale.clocks.title).toBe(t2);
  });

  it('orders clocks by instant, not by string, when ISO precision differs', () => {
    const created = applyChoreOp(null, { fields: dishes, updated_at: '2026-09-09T11:00:00Z' });
    if (!created.ok) throw new Error('setup');
    // Same instant written with milliseconds sorts after 'Z' as a string but is not newer.
    const same = applyChoreOp(created, {
      fields: { title: 'Same instant' },
      updated_at: '2026-09-09T11:00:00.000Z',
    });
    if (!same.ok) throw new Error('setup');
    const earlier = applyChoreOp(same, {
      fields: { title: 'Earlier' },
      updated_at: '2026-09-09T10:59:59.999Z',
    });
    expect(earlier.ok && earlier.fields.title).toBe('Same instant');
    expect(earlier.ok && earlier.clocks.title).toBe('2026-09-09T11:00:00.000Z');
  });

  it('rejects an op whose merged result is invalid, e.g. kind→weekdays without a mask', () => {
    const created = applyChoreOp(null, { fields: dishes, updated_at: t1 });
    if (!created.ok) throw new Error('setup');
    const r = applyChoreOp(created, { fields: { kind: 'weekdays' }, updated_at: t2 });
    expect(r.ok).toBe(false);
  });
});
