import { describe, expect, it } from 'vitest';
import { en } from './i18n/en.ts';
import { he } from './i18n/he.ts';
import {
  BUILTIN_REWARDS,
  BUILTIN_REWARD_KEYS,
  builtinRewardId,
  builtinRewardsFor,
} from './reward.ts';
import { uuid5 } from './uuid5.ts';

const HOUSEHOLD = '3f6c1c1e-0f1a-4b2b-9f6a-1d2e3f4a5b6c';
const OTHER = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const AT = '2026-01-01T00:00:00.000Z';

describe('the built-in reward catalog', () => {
  it('is the three the spec names, at the coin values it names', () => {
    expect(BUILTIN_REWARDS.map((r) => [r.builtin_key, r.cost_coins])).toEqual([
      ['snack', 50],
      ['screen_time', 150],
      ['friday_dinner', 400],
    ]);
  });

  it('has a title in every locale, because the row carries a key and no title', () => {
    for (const key of BUILTIN_REWARD_KEYS) {
      expect(builtinRewardsFor(HOUSEHOLD, AT).find((r) => r.builtin_key === key)?.title).toBeNull();
      expect(en.rewards.builtin[key].trim()).not.toBe('');
      expect(he.rewards.builtin[key].trim()).not.toBe('');
    }
  });
});

describe('copying the catalog into a household', () => {
  it('gives every row that household, a key, and no title', () => {
    const rows = builtinRewardsFor(HOUSEHOLD, AT);
    expect(rows).toHaveLength(BUILTIN_REWARD_KEYS.length);
    for (const row of rows) {
      expect(row.household_id).toBe(HOUSEHOLD);
      expect(row.builtin_key).not.toBeNull();
      expect(row.title).toBeNull();
      expect(row.is_builtin).toBe(true);
      expect(row.active).toBe(true);
      expect(row.deleted_at).toBeNull();
    }
    expect(rows.map((r) => r.sort)).toEqual([0, 1, 2]);
  });

  it('derives ids from the household, so two households never share a row', () => {
    const mine = builtinRewardsFor(HOUSEHOLD, AT).map((r) => r.id);
    const theirs = builtinRewardsFor(OTHER, AT).map((r) => r.id);
    expect(new Set([...mine, ...theirs]).size).toBe(mine.length + theirs.length);
  });

  it('is deterministic, so seeding twice is the same three rows', () => {
    expect(builtinRewardsFor(HOUSEHOLD, AT)).toEqual(builtinRewardsFor(HOUSEHOLD, AT));
    expect(builtinRewardId(HOUSEHOLD, 'snack')).toBe(uuid5('reward', HOUSEHOLD, 'snack'));
  });
});
