import { describe, expect, it } from 'vitest';
import {
  PET_LEVEL_THRESHOLDS,
  PET_MAX_LEVEL,
  displayedPetLevel,
  petLevel,
  petMood,
} from './pet.ts';
import type { DaySummary } from './day-summary.ts';

const summary = (due_count: number, done_count: number): DaySummary => ({
  child_id: 'noa',
  chore_date: '2026-09-09',
  due_count,
  done_count,
  complete: due_count > 0 && done_count === due_count,
  streak_after: 0,
});

describe('petLevel', () => {
  it('has five levels starting at level 1 with zero XP', () => {
    expect(PET_MAX_LEVEL).toBe(5);
    expect(PET_LEVEL_THRESHOLDS).toEqual([0, 100, 300, 700, 1500]);
    expect(petLevel(0)).toBe(1);
    expect(petLevel(99)).toBe(1);
    expect(petLevel(100)).toBe(2);
    expect(petLevel(299)).toBe(2);
    expect(petLevel(300)).toBe(3);
    expect(petLevel(700)).toBe(4);
    expect(petLevel(1500)).toBe(5);
    expect(petLevel(999_999)).toBe(5);
  });

  it('never drops below level 1 even if XP goes negative through clawbacks', () => {
    expect(petLevel(-40)).toBe(1);
  });
});

describe('displayedPetLevel', () => {
  it('never goes down once shown, even when XP is clawed back', () => {
    expect(displayedPetLevel(100, 1)).toBe(2);
    expect(displayedPetLevel(90, 2)).toBe(2);
    expect(displayedPetLevel(300, 2)).toBe(3);
    expect(displayedPetLevel(0, 0)).toBe(1);
  });
});

describe('petMood', () => {
  it('is happy when today is complete, content when some are done, sleepy otherwise', () => {
    expect(petMood(summary(3, 3))).toBe('happy');
    expect(petMood(summary(3, 1))).toBe('content');
    expect(petMood(summary(3, 0))).toBe('sleepy');
  });

  it('is sleepy with no summary for today or a frozen day', () => {
    expect(petMood(undefined)).toBe('sleepy');
    expect(petMood(summary(0, 0))).toBe('sleepy');
  });
});
