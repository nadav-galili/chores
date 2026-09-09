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

/** Where the XP bar stands: the band of the level being shown, and how far into it the child is. */
export type PetProgress = {
  /** The level on screen — `displayedPetLevel`, so it never drops. */
  level: number;
  /** Total XP, `SUM(xp)`. */
  xp: number;
  /** XP earned into the current level's band, never negative. */
  into: number;
  /** The band's width. Zero at the top level, where there is nothing left to fill. */
  needed: number;
  /** `into / needed`, 0..1. One at the top level. */
  fraction: number;
  atMax: boolean;
};

/**
 * The XP bar for a child holding `totalXp` whose pet has already been shown at `shownLevel`.
 *
 * The bar follows the displayed level rather than the earned one, so a clawback empties the bar
 * instead of demoting the pet: the child keeps what they were told they had (docs/spec/01-product.md,
 * "UI level is monotonic even if XP is clawed back").
 */
export function petProgress(totalXp: number, shownLevel: number): PetProgress {
  const level = displayedPetLevel(totalXp, shownLevel);
  if (level >= PET_MAX_LEVEL) {
    return { level: PET_MAX_LEVEL, xp: totalXp, into: 0, needed: 0, fraction: 1, atMax: true };
  }
  const floor = PET_LEVEL_THRESHOLDS[level - 1]!;
  const next = PET_LEVEL_THRESHOLDS[level]!;
  const needed = next - floor;
  const into = Math.min(Math.max(totalXp - floor, 0), needed);
  return { level, xp: totalXp, into, needed, fraction: into / needed, atMax: false };
}
