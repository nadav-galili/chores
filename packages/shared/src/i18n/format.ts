import type { IsoDate } from '../chore-date.ts';
import type { Locale } from '../locale.ts';

/**
 * Everything that reads as a number, a date or a day of the week, said the way the phone's locale
 * says it. Pure: the locale is always an argument, so this file is the one place a format lives
 * and the whole of it is testable off-device.
 */

/** The regional tag each locale formats with. English is `en-GB`: day before month, 24-hour clock. */
const TAG: Readonly<Record<Locale, string>> = { en: 'en-GB', he: 'he-IL' };

/** Weekday chips have to fit on one line: Hebrew's short form is `יום ב׳`, its narrow one `ב׳`. */
const WEEKDAY_STYLE: Readonly<Record<Locale, 'short' | 'narrow'>> = { en: 'short', he: 'narrow' };

export function formatNumber(locale: Locale, value: number): string {
  return new Intl.NumberFormat(TAG[locale]).format(value);
}

/**
 * A chore date — a household-local calendar day, never an instant — read out in the locale. The
 * parts are put back together in UTC and formatted in UTC, so no timezone can shift the day.
 */
export function formatChoreDate(locale: Locale, date: IsoDate): string {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  return new Intl.DateTimeFormat(TAG[locale], {
    timeZone: 'UTC',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(new Date(Date.UTC(year, month - 1, day)));
}

/**
 * The wall clock an instant read in `tz`, on a 24-hour clock in both locales. The zone is the
 * household's, not the reading device's: a parent away from home sees the time their child saw.
 */
export function formatWallClock(locale: Locale, instant: string, tz: string): string {
  return new Intl.DateTimeFormat(TAG[locale], {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(instant));
}

/** The seven weekday labels in mask-bit order, Mon=0 … Sun=6 (`chore.weekday_mask`). */
export function weekdayLabels(locale: Locale): string[] {
  const format = new Intl.DateTimeFormat(TAG[locale], {
    timeZone: 'UTC',
    weekday: WEEKDAY_STYLE[locale],
  });
  // 2024-01-01 was a Monday, so seven days from it are Mon … Sun in mask-bit order.
  return Array.from({ length: 7 }, (_, i) => format.format(new Date(Date.UTC(2024, 0, 1 + i))));
}
