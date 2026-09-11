import type { UiMode } from '@chores/shared';
import type { Role } from '@/lib/role';
import {
  displayFontFamily,
  kidColors,
  LITTLE_TYPE_MULTIPLIER,
  parentColors,
  radius,
  space,
  touchTargets,
  typeSizes,
  type ColorTokens,
  type TypeStep,
} from './tokens';

export type TextStyleToken = {
  fontSize: number;
  lineHeight: number;
  /**
   * Set only where Rubik carries the step. The weight lives in the face, so no
   * `fontWeight` rides along: on Android, pairing one with an explicitly named
   * SemiBold family gets you synthetic bolding or a fallback face.
   */
  fontFamily?: string;
};

export type TypeScale = Record<TypeStep, TextStyleToken>;

export type Theme = {
  colors: ColorTokens;
  space: typeof space;
  radius: typeof radius;
  type: TypeScale;
  /** The minimum height and width of anything tappable, in points. */
  touchTarget: number;
  /**
   * The mode this theme was selected for, so the two differences a component has to draw for
   * itself — where the pet sits, and the voice of the copy — are read from the same value that
   * sized the type and the touch targets, and cannot drift from it. The parent theme carries
   * `big` because the parent side has no child to have a mode.
   */
  uiMode: UiMode;
};

/** Rubik 600 is spent on the two largest steps only. */
const rubikSteps = new Set<TypeStep>(['display', 'title']);

function buildTypeScale(multiplier: number): TypeScale {
  const steps = Object.entries(typeSizes) as [TypeStep, number][];
  return Object.freeze(
    Object.fromEntries(
      steps.map(([step, base]) => {
        const fontSize = Math.round(base * multiplier);
        return [
          step,
          Object.freeze({
            fontSize,
            lineHeight: Math.round(fontSize * 1.3),
            ...(rubikSteps.has(step) ? { fontFamily: displayFontFamily } : {}),
          }),
        ];
      }),
    ),
  ) as TypeScale;
}

function buildTheme(
  colors: ColorTokens,
  typeMultiplier: number,
  touchTarget: number,
  uiMode: UiMode,
): Theme {
  return Object.freeze({
    colors: Object.freeze({ ...colors }),
    space,
    radius,
    type: buildTypeScale(typeMultiplier),
    touchTarget,
    uiMode,
  });
}

export const kidBigTheme = buildTheme(kidColors, 1, touchTargets.big, 'big');
export const kidLittleTheme = buildTheme(
  kidColors,
  LITTLE_TYPE_MULTIPLIER,
  touchTargets.little,
  'little',
);
export const parentTheme = buildTheme(parentColors, 1, touchTargets.big, 'big');

/**
 * Picks one of three frozen themes. It selects; it does not compute — every
 * theme above is built once at module load.
 */
export function selectTheme(role: Role, uiMode: UiMode): Theme {
  if (role === 'parent') return parentTheme;
  return uiMode === 'little' ? kidLittleTheme : kidBigTheme;
}
