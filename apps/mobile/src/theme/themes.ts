import type { UiMode } from '@chores/shared';
import type { Role } from '@/lib/role';
import {
  displayFontFamily,
  kidColors,
  LITTLE_TYPE_MULTIPLIER,
  parentColors,
  radius,
  space,
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

function buildTheme(colors: ColorTokens, typeMultiplier: number): Theme {
  return Object.freeze({
    colors: Object.freeze({ ...colors }),
    space,
    radius,
    type: buildTypeScale(typeMultiplier),
  });
}

export const kidBigTheme = buildTheme(kidColors, 1);
export const kidLittleTheme = buildTheme(kidColors, LITTLE_TYPE_MULTIPLIER);
export const parentTheme = buildTheme(parentColors, 1);

/**
 * Picks one of three frozen themes. It selects; it does not compute — every
 * theme above is built once at module load.
 */
export function selectTheme(role: Role, uiMode: UiMode): Theme {
  if (role === 'parent') return parentTheme;
  return uiMode === 'little' ? kidLittleTheme : kidBigTheme;
}
