import { t } from '@/lib/i18n';

/**
 * Placeholder tree art, bundled in the app: one entry per stage, no files and no network, so the
 * grove draws the same offline as on — the same seam `pet-art.ts` uses, and the same reason
 * (docs/spec/04-milestones.md, risks: "placeholder art in M1 tells you nothing about the mechanic;
 * budget real art before the week-3 verdict"). Swap `glyph` for an image source and every screen
 * that draws a tree keeps working.
 */

export type TreeArt = {
  /** The tree at this stage. */
  glyph: string;
  /** The ground it stands on. */
  ground: string;
};

const GLYPHS = ['🌰', '🌱', '🌿', '🪴', '🌳', '🌸'] as const;
const GROUNDS = ['#EFEAE1', '#EAF4E3', '#E2F1DA', '#DCEFD2', '#D5ECC9', '#F7E9F2'] as const;

/** How many trees the last stage stands for; past it, the tree keeps its final form. */
export const TREE_STAGES = GLYPHS.length;

/**
 * The art for one Grove Stage. A stage past the last drawing keeps the last one — the count goes
 * on rising forever, and the child is never told they have stopped growing.
 */
export function treeArt(stage: number): TreeArt {
  const i = Math.min(Math.max(Math.floor(stage), 0), TREE_STAGES - 1);
  return { glyph: GLYPHS[i]!, ground: GROUNDS[i]! };
}

/** What a screen reader says instead of the art. */
export function treeArtLabel(name: string, stage: number): string {
  return t('grove.treeLabel', { name, count: stage });
}
