import {
  CATALOGS,
  DEFAULT_LOCALE,
  isRtl,
  pickLocale,
  type Catalog,
  type Locale,
} from '@chores/shared';
import * as format from '@chores/shared';
import { getLocales } from 'expo-localization';
import { I18n, type TranslateOptions } from 'i18n-js';
import { I18nManager } from 'react-native';

/**
 * What the app says, and which way round it says it (docs/spec/01-product.md: "i18n with English
 * default, Hebrew as the tested locale, RTL from day one"). The catalogs and the formatters are
 * shared; this file is the device half — the phone's locale, and the layout direction.
 *
 * The locale is read once at launch: nothing in M1 lets a family pick a language inside the app,
 * so there is nothing to re-render when it changes — the phone restarts the app. Direction is the
 * same story. Android and iOS already lay an app out right to left when the phone's language is,
 * so the flip below is only for the case where the two disagree — a phone in another RTL language
 * we do not speak, which falls back to English — and React Native can only change direction at
 * startup, so that one mirrors on its next launch.
 */

export const locale: Locale = pickLocale(getLocales().map((l) => l.languageTag));
export const isRTL = isRtl(locale);

if (I18nManager.isRTL !== isRTL) {
  I18nManager.allowRTL(isRTL);
  I18nManager.forceRTL(isRTL);
}

const i18n = new I18n(CATALOGS, {
  locale,
  defaultLocale: DEFAULT_LOCALE,
  // A key that only English has still says something rather than showing its own name.
  enableFallback: true,
});

// Hebrew counts two of a thing as one word — `יומיים`, not `2 ימים` — so it gets a form English
// has no use for. Anything without a `two` in the catalog falls through to `other`.
i18n.pluralization.register('he', (_i18n, count) => {
  if (count === 1) return ['one', 'other'];
  if (count === 2) return ['two', 'other'];
  return ['other'];
});

/** `a.b.c` for every string in the catalog; anything else is a typecheck failure. */
type Plural = { one: string; other: string };
type Keys<T> = T extends string
  ? never
  : T extends Plural
    ? never
    : {
        [K in keyof T & string]: Keys<T[K]> extends never ? K : `${K}.${Keys<T[K]>}`;
      }[keyof T & string];

export type TranslationKey = Keys<Catalog>;

/** One string, in the phone's language. `count` picks a plural form; `%{name}` is interpolated. */
export function t(key: TranslationKey, options?: TranslateOptions): string {
  return i18n.t(key, options);
}

/** The formatters, bound to the locale the app is running in. */
export const formatNumber = (value: number) => format.formatNumber(locale, value);
export const formatChoreDate = (date: string) => format.formatChoreDate(locale, date);
export const formatWallClock = (instant: string, tz: string) =>
  format.formatWallClock(locale, instant, tz);
export const weekdayLabels = () => format.weekdayLabels(locale);

/** Arrows point the way the reader is going, so in Hebrew they point the other way. */
export const CHEVRON = isRTL ? '‹' : '›';
export const BACK_ARROW = isRTL ? '→' : '←';

/** A zod issue, said the same way by every form. */
export function fieldError(issue: { path: PropertyKey[]; message?: string } | undefined): string {
  return t('errors.field', {
    field: issue?.path.join('.') ?? t('errors.form'),
    message: issue?.message ?? t('errors.invalid'),
  });
}
