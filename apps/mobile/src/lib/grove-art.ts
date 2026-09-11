import { treeForm } from '@chores/shared';
import type { ImageSourcePropType } from 'react-native';
import { t } from '@/lib/i18n';

/**
 * The grove's art, bundled in the app: one image per Tree Form and one ground the whole row
 * stands on. Nothing is fetched, so the grove draws the same offline as on.
 *
 * The ladder between an unbounded Grove Stage and something drawable is `treeForm` in
 * `packages/shared`, not here — this file only holds the eight files it indexes. That is what
 * makes the drawn form as monotonic as the count behind it: `treeForm` never decreases, growth
 * entries are never clawed back (ADR-0011), so a rejection that syncs in cannot shrink a tree.
 *
 * The requires are literal because Metro resolves an asset path only at build time — a computed
 * path bundles nothing and fails at runtime. The filenames are the ones the manifest in
 * `docs/design/prompts.md` fixes, and the art swap replaced these nine files without touching a
 * require. What ships here is the finished art: one broadleaf across all eight forms, blossom at
 * six, fruit at seven, heavy fruit at eight.
 */

const FORMS = [
  require('../../assets/grove/tree-s1.webp'),
  require('../../assets/grove/tree-s2.webp'),
  require('../../assets/grove/tree-s3.webp'),
  require('../../assets/grove/tree-s4.webp'),
  require('../../assets/grove/tree-s5.webp'),
  require('../../assets/grove/tree-s6.webp'),
  require('../../assets/grove/tree-s7.webp'),
  require('../../assets/grove/tree-s8.webp'),
] as const satisfies readonly ImageSourcePropType[];

/** The ground every tree in the grove stands on — one image, shared by the whole row. */
export const GROVE_GROUND: ImageSourcePropType = require('../../assets/grove/ground.webp');

/**
 * Where a tree's base sits in its own square, as a fraction of the canvas height. Every form is
 * trimmed and re-padded to this one line (`docs/design/prompts.md`, post-process step 3), which
 * is what lets trees drawn at different sizes share a horizon: the drawing bottom is 90% down,
 * not at the bottom edge.
 */
export const TREE_BASE = 0.9;

/**
 * The art for one Grove Stage: eight files, one per Tree Form. `treeForm` clamps at both ends,
 * and the index is clamped to the map as well, so a ladder that grows in `packages/shared`
 * before the art does draws the last form rather than nothing.
 */
export function treeArt(stage: number): ImageSourcePropType {
  return FORMS[Math.min(treeForm(stage), FORMS.length) - 1]!;
}

/** What a screen reader says instead of the art. */
export function treeArtLabel(name: string, stage: number): string {
  return t('grove.treeLabel', { name, count: stage });
}
