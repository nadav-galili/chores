import { z } from 'zod';
import type { DaySummary } from './day-summary.ts';

/** XP needed to reach each level; index 0 is level 1. One species, five levels (docs/spec/01-product.md). */
export const PET_LEVEL_THRESHOLDS: readonly number[] = [0, 100, 300, 700, 1500];
export const PET_MAX_LEVEL = PET_LEVEL_THRESHOLDS.length;

export const petMoodSchema = z.enum(['happy', 'content', 'sleepy']);
export type PetMood = z.infer<typeof petMoodSchema>;

/** Level from total XP (`SUM(xp)`), 1..PET_MAX_LEVEL. Never below 1, even if clawbacks push XP negative. */
export function petLevel(totalXp: number): number {
  let level = 1;
  for (let i = 1; i < PET_LEVEL_THRESHOLDS.length; i++) {
    if (totalXp >= PET_LEVEL_THRESHOLDS[i]!) level = i + 1;
  }
  return level;
}

/** The level to show the child: never lower than one already shown, even if XP was clawed back. */
export function displayedPetLevel(totalXp: number, previouslyShown: number): number {
  return Math.max(petLevel(totalXp), previouslyShown, 1);
}

/** Mood from today's summary: happy when the day is complete, content when something is done, sleepy otherwise. */
export function petMood(today: Pick<DaySummary, 'complete' | 'done_count'> | undefined): PetMood {
  if (today === undefined) return 'sleepy';
  if (today.complete) return 'happy';
  if (today.done_count > 0) return 'content';
  return 'sleepy';
}
