import { describe, expect, it } from 'vitest';
import {
  PET_LEVEL_THRESHOLDS,
  PET_MAX_LEVEL,
  displayedPetLevel,
  petLevel,
  petMood,
  petProgress,
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

describe('petProgress', () => {
  it('fills the bar across the band of the current level', () => {
    expect(petProgress(0, 1)).toMatchObject({ level: 1, into: 0, needed: 100, fraction: 0 });
    expect(petProgress(50, 1)).toMatchObject({ level: 1, into: 50, needed: 100, fraction: 0.5 });
    expect(petProgress(100, 1)).toMatchObject({ level: 2, into: 0, needed: 200, fraction: 0 });
    expect(petProgress(200, 1)).toMatchObject({ level: 2, into: 100, needed: 200, fraction: 0.5 });
  });

  it('is full and going nowhere at the top level', () => {
    expect(petProgress(1500, 1)).toMatchObject({
      level: 5,
      into: 0,
      needed: 0,
      fraction: 1,
      atMax: true,
    });
    expect(petProgress(99_999, 5).atMax).toBe(true);
  });

  it('follows the displayed level, so a clawback empties the bar instead of dropping a level', () => {
    // Level 3 was reached and shown; XP then fell back into level 2's band.
    expect(petProgress(250, 3)).toMatchObject({ level: 3, into: 0, needed: 400, fraction: 0 });
  });

  it('carries the total XP through untouched', () => {
    expect(petProgress(250, 1).xp).toBe(250);
    expect(petProgress(-40, 1)).toMatchObject({ level: 1, into: 0, fraction: 0 });
  });
});
