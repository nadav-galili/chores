import { describe, expect, it } from 'vitest';
import {
  GRACE_DAYS,
  canDo,
  gateFor,
  graceEndsAt,
  type GatedAction,
  type Gate,
} from './entitlement.ts';

const free = { entitlement: 'free' as const };
const premium = { entitlement: 'premium' as const };
const now = '2026-09-09T12:00:00.000Z';
const counts = { child_count: 1, parent_count: 1 };

describe('canDo', () => {
  const premiumOnly: [GatedAction, Gate][] = [
    ['custom_reward', 'custom_rewards'],
    ['money_ledger', 'money_ledger'],
    ['full_history', 'full_history'],
    ['photo_proof', 'photo_proof'],
  ];

  it.each(premiumOnly)('%s: premium only, gate %s', (action, gate) => {
    expect(canDo(premium, action, { now, ...counts })).toEqual({ ok: true });
    expect(canDo(free, action, { now, ...counts })).toEqual({ ok: false, gate });
    expect(gateFor(action)).toBe(gate);
  });

  it('add_parent: the free tier allows two parents', () => {
    const ctx = (parent_count: number) => ({ now, child_count: 1, parent_count });
    expect(canDo(free, 'add_parent', ctx(0))).toEqual({ ok: true });
    expect(canDo(free, 'add_parent', ctx(1))).toEqual({ ok: true });
    expect(canDo(free, 'add_parent', ctx(2))).toEqual({ ok: false, gate: 'parent_quota' });
    expect(canDo(premium, 'add_parent', ctx(9))).toEqual({ ok: true });
  });

  it('add_child: the free tier has one child; beyond that the child is added under a 14-day grace', () => {
    const ctx = (child_count: number) => ({ now, child_count, parent_count: 1 });
    const grace = { ok: true, read_only_after: '2026-09-23T12:00:00.000Z' };
    expect(canDo(free, 'add_child', ctx(0))).toEqual({ ok: true });
    expect(canDo(free, 'add_child', ctx(1))).toEqual(grace);
    expect(canDo(free, 'add_child', ctx(2))).toEqual(grace);
    expect(canDo(premium, 'add_child', ctx(5))).toEqual({ ok: true });
  });

  it('edit_child: a free-tier child becomes read-only for parents once read_only_after passes', () => {
    const editable = { read_only_after: null };
    const soon = { read_only_after: '2026-09-10T00:00:00.000Z' };
    const passed = { read_only_after: '2026-09-09T12:00:00.000Z' };
    const offset = { read_only_after: '2026-09-09T14:00:00.000+03:00' }; // 11:00Z, already passed
    const ctx = (child: { read_only_after: string | null }) => ({ now, ...counts, child });
    expect(canDo(free, 'edit_child', ctx(editable))).toEqual({ ok: true });
    expect(canDo(free, 'edit_child', ctx(soon))).toEqual({ ok: true });
    expect(canDo(free, 'edit_child', ctx(passed))).toEqual({ ok: false, gate: 'child_quota' });
    expect(canDo(free, 'edit_child', ctx(offset))).toEqual({ ok: false, gate: 'child_quota' });
    expect(canDo(premium, 'edit_child', ctx(passed))).toEqual({ ok: true });
  });
});

describe('graceEndsAt', () => {
  it('is 14 days after the child was added', () => {
    expect(GRACE_DAYS).toBe(14);
    expect(graceEndsAt('2026-09-09T12:00:00.000Z')).toBe('2026-09-23T12:00:00.000Z');
  });
});
