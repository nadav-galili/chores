import { PET_MAX_LEVEL, type PetMood } from '@chores/shared';
import type { ImageSourcePropType } from 'react-native';
import { t } from '@/lib/i18n';
import { petMoodGrounds } from '@/theme/tokens';

/**
 * The pet's art, bundled in the app: a body per level, a mood mark composited over it, and a
 * ground tint behind. Nothing is fetched, so the pet draws the same offline as on. The tints are
 * the only part not written down here: colour values live in the theme module and nowhere else.
 *
 * Eight images cover fifteen combinations — five bodies against three marks — which is what keeps
 * the whole set holdable in one style (docs/spec/04-milestones.md, risks: "placeholder art in M1
 * tells you nothing about the mechanic; budget real art before the week-3 verdict"). The images
 * here are the finished renders, swapped in over the placeholders without touching a require:
 * everything that reads a pet goes through `petArt`, so the swap was eight files and no code.
 *
 * The requires are literal because Metro resolves an asset path only at build time — a computed
 * path bundles nothing and fails at runtime. The filenames are the ones the manifest in
 * `docs/design/prompts.md` fixes, and the five bodies share one baseline — content bottom at 85%
 * of the canvas — so a level change moves the bird's age and not its feet.
 */

export type PetArt = {
  /** The creature at this level. */
  body: ImageSourcePropType;
  /** What its mood adds, drawn over the body. */
  mark: ImageSourcePropType;
  /** Background behind the art, from the theme's pet tints. */
  ground: string;
  /** The name of this stage, shown under the pet. */
  stage: string;
};

const STAGES = ['egg', 'hatchling', 'fledgling', 'full', 'splendid'] as const;

const BODIES = [
  require('../../assets/pet/pet-l1.webp'),
  require('../../assets/pet/pet-l2.webp'),
  require('../../assets/pet/pet-l3.webp'),
  require('../../assets/pet/pet-l4.webp'),
  require('../../assets/pet/pet-l5.webp'),
] as const satisfies readonly ImageSourcePropType[];

const MARKS: Readonly<Record<PetMood, ImageSourcePropType>> = {
  happy: require('../../assets/pet/pet-mood-happy.webp'),
  content: require('../../assets/pet/pet-mood-content.webp'),
  sleepy: require('../../assets/pet/pet-mood-sleepy.webp'),
};

/**
 * The art for one level and mood — five stages against three moods, fifteen combinations. Both
 * arguments are clamped, so this can never fail to draw something.
 */
export function petArt(level: number, mood: PetMood): PetArt {
  const i = Math.min(Math.max(Math.floor(level), 1), PET_MAX_LEVEL) - 1;
  return {
    body: BODIES[i]!,
    stage: t(`pet.stage.${STAGES[i]!}`),
    mark: MARKS[mood],
    ground: petMoodGrounds[mood],
  };
}

/** What a screen reader says instead of the art. */
export function petArtLabel(name: string, level: number, mood: PetMood): string {
  return t('pet.artLabel', { name, level, mood: t(`pet.moodWord.${mood}`) });
}
