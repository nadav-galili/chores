import { PET_MAX_LEVEL, type PetMood } from '@chores/shared';

/**
 * Placeholder pet art, bundled in the app: one entry per level per mood, no files and no network,
 * so the pet draws the same offline as on.
 *
 * This table is the seam real art drops into (docs/spec/04-milestones.md, risks: "placeholder art
 * in M1 tells you nothing about the mechanic; budget real art before the week-3 verdict"). Swap
 * `glyph` and `face` for image sources and everything that reads a pet keeps working.
 */

export type PetArt = {
  /** The creature at this level. */
  glyph: string;
  /** What its mood adds. */
  face: string;
  /** Background behind the art. */
  ground: string;
  /** The name of this stage, shown under the pet. */
  stage: string;
};

const STAGES = ['Egg', 'Hatchling', 'Chick', 'Fledgling', 'Splendid'] as const;
const GLYPHS = ['🥚', '🐣', '🐤', '🐦', '🦚'] as const;

const MOOD: Readonly<Record<PetMood, { face: string; ground: string }>> = {
  happy: { face: '✨', ground: '#FFF4CC' },
  content: { face: '🎵', ground: '#E6F4FE' },
  sleepy: { face: '💤', ground: '#ECECF2' },
};

/**
 * The art for one level and mood — five stages against three moods, fifteen combinations. Both
 * arguments are clamped, so this can never fail to draw something.
 */
export function petArt(level: number, mood: PetMood): PetArt {
  const i = Math.min(Math.max(Math.floor(level), 1), PET_MAX_LEVEL) - 1;
  return { glyph: GLYPHS[i]!, stage: STAGES[i]!, ...MOOD[mood] };
}

/** What a screen reader says instead of the art. */
export function petArtLabel(name: string, level: number, mood: PetMood): string {
  return `${name}, level ${level}, ${mood}`;
}
