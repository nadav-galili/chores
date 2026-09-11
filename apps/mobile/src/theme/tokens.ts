/**
 * The raw token values. Names are semantic — what a value is *for*, never what
 * hue it happens to be — so that retuning the palette is a value change here and
 * nothing else. One colour means "act"; the Coin colour is reserved for Coin
 * display alone and is referenced by no button, chip, badge or chrome.
 *
 * Colours live in the mobile app, not in `packages/shared`: that workspace is
 * zod schemas and correctness-critical pure logic, and a palette is neither.
 *
 * See issue #19 for the visual direction these values come from.
 */

import type { PetMood } from '@chores/shared';

export type ColorTokens = {
  /** The page behind everything. */
  ground: string;
  /** Cards and rows that sit on the ground. */
  surface: string;
  /** The one colour that means "act". Buttons, active chips, links. */
  action: string;
  /** Text and icons drawn on top of `action`, and nothing else. */
  onAction: string;
  /** The Grove's living green. Illustrations and growth affordances only. */
  growth: string;
  /** Reserved: Coin display and nothing else. No button, chip, badge or chrome. */
  coin: string;
  /** Primary text. */
  text: string;
  /** Secondary text, borders, placeholders. */
  muted: string;
  /** Destructive actions and error copy. */
  danger: string;
};

/**
 * The three tints behind the pet, one per mood. Art rather than chrome — they are the
 * background of an illustration and nothing else reads them — but they are colour values, so
 * they live here with every other colour value rather than beside the `require`s in
 * `src/lib/pet-art.ts`. Shared by both themes: the pet is the child's, and the parent side
 * never draws one.
 */
export const petMoodGrounds: Readonly<Record<PetMood, string>> = Object.freeze({
  happy: '#FFF4CC',
  content: '#E6F4FE',
  sleepy: '#ECECF2',
});

/** Calm & natural at full strength — the child's world. */
export const kidColors: ColorTokens = {
  ground: '#F2F6F1',
  surface: '#FFFFFF',
  action: '#2F6B4F',
  onAction: '#FFFFFF',
  growth: '#8CBF9E',
  coin: '#E9B949',
  text: '#1B2A22',
  muted: '#5F7168',
  danger: '#B3261E',
};

/** The same tokens in a quieter key — desaturated, for the evening admin pass. */
export const parentColors: ColorTokens = {
  ground: '#F5F7F5',
  surface: '#FFFFFF',
  action: '#35594A',
  onAction: '#FFFFFF',
  growth: '#A6BCAF',
  coin: '#C9A64E',
  text: '#23302A',
  muted: '#6C7A73',
  danger: '#9C3A33',
};

// Every theme shares these two objects, so they are frozen at runtime and not
// merely `as const`: one stray write would otherwise reach all three themes.
export const space = Object.freeze({
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const);

export const radius = Object.freeze({
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  pill: 999,
} as const);

/**
 * The smallest a thing you tap may be. `little` gets the larger one: target size is the second
 * of the three differences between the modes (docs/spec/06-design.md), and it is a size rather
 * than a multiplier because a target has a floor that type does not.
 */
export const touchTargets = Object.freeze({ big: 48, little: 56 } as const);

/** Rubik 600 carries display and title; everything else stays on the system font. */
export const displayFontFamily = 'Rubik-SemiBold';

/** Base sizes, shared by both modes. `little` differs by one multiplier, below. */
export const typeSizes = {
  display: 34,
  title: 26,
  heading: 20,
  body: 17,
  label: 15,
  caption: 13,
} as const;

export type TypeStep = keyof typeof typeSizes;

/** The single place `little` mode grows type. Tune child legibility here. */
export const LITTLE_TYPE_MULTIPLIER = 1.15;
