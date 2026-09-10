import { z } from 'zod';

/**
 * The languages the app speaks: English by default, Hebrew as the locale the family this is built
 * for actually reads (docs/spec/01-product.md, "i18n with English default, Hebrew as the tested
 * locale, RTL from day one").
 */
export const LOCALES = ['en', 'he'] as const;
export const localeSchema = z.enum(LOCALES);
export type Locale = z.infer<typeof localeSchema>;

export const DEFAULT_LOCALE: Locale = 'en';

/** Hebrew reads right to left; everything the layout mirrors hangs off this. */
export function isRtl(locale: Locale): boolean {
  return locale === 'he';
}

/**
 * The locale for a phone that lists its languages most-preferred first, as expo-localization hands
 * them over. Anything we do not speak is skipped rather than falling straight back to English, so
 * a phone set to Russian with Hebrew behind it still reads Hebrew.
 */
export function pickLocale(preferred: readonly (string | null | undefined)[]): Locale {
  for (const tag of preferred) {
    const language = tag?.split('-')[0]?.toLowerCase();
    // `iw` is the retired ISO code for Hebrew; Android still emits it.
    const normalized = language === 'iw' ? 'he' : language;
    const match = localeSchema.safeParse(normalized);
    if (match.success) return match.data;
  }
  return DEFAULT_LOCALE;
}
