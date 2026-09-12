import { z } from 'zod';

/** Household-local calendar date, `YYYY-MM-DD`. Never a UTC date. */
export type IsoDate = string;

const HOUR_MS = 3_600_000;
const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(tz: string): Intl.DateTimeFormat {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    formatters.set(tz, f);
  }
  return f;
}

/**
 * The chore date an instant belongs to: the calendar date in `tz` of
 * `instant − dayBoundaryHour` hours (docs/spec/02-data-model.md, timezone rules).
 * Shifting the instant, not the local date, is what keeps DST from moving a day.
 */
export function choreDate(instant: Date, tz: string, dayBoundaryHour: number): IsoDate {
  if (!Number.isInteger(dayBoundaryHour) || dayBoundaryHour < 0 || dayBoundaryHour > 6) {
    throw new RangeError(`day_boundary_hour must be an integer 0-6, got ${dayBoundaryHour}`);
  }
  const shifted = new Date(instant.getTime() - dayBoundaryHour * HOUR_MS);
  const parts = formatterFor(tz).formatToParts(shifted);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** `date` moved by `days` on the calendar. Local-date arithmetic only, so DST cannot shift it. */
export function addDays(date: IsoDate, days: number): IsoDate {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const moved = new Date(Date.UTC(y, m - 1, d + days));
  return moved.toISOString().slice(0, 10);
}

/** `YYYY-MM-DD`, the only shape a chore date ever has on the wire. */
export const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD');

/** Whole days from `from` to `to`, signed. Calendar arithmetic only. */
export function daysBetween(from: IsoDate, to: IsoDate): number {
  const utc = (date: IsoDate) => {
    const [y, m, d] = date.split('-').map(Number) as [number, number, number];
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((utc(to) - utc(from)) / (24 * HOUR_MS));
}

export type ResolvedChoreDate = { chore_date: IsoDate; date_adjusted: boolean };

/**
 * The chore date to write when a device claims one and the server computes another from
 * `completed_at`: a device clock off by up to a day is trusted, anything further is overridden
 * and flagged (docs/spec/02-data-model.md, timezone rules).
 */
export function resolveChoreDate(claimed: IsoDate, computed: IsoDate): ResolvedChoreDate {
  return Math.abs(daysBetween(computed, claimed)) <= 1
    ? { chore_date: claimed, date_adjusted: false }
    : { chore_date: computed, date_adjusted: true };
}

/**
 * The Redo Window: the two Chore Dates after an instance's own, during which its redo may still
 * be completed (CONTEXT.md, Redo Window).
 */
export const REDO_WINDOW_DAYS = 2;

/**
 * Whether an instance on `date` may still be completed on `today` — its own Chore Date and the
 * two after it. A date in the future is inside it; only age closes the window.
 */
export function withinRedoWindow(date: IsoDate, today: IsoDate): boolean {
  return date >= redoWindowStart(today);
}

/**
 * The oldest Chore Date still inside the window on `today`. The same rule as `withinRedoWindow`,
 * shaped as a bound so a query can hold it in its `where` instead of filtering rows afterwards.
 */
export function redoWindowStart(today: IsoDate): IsoDate {
  return addDays(today, -REDO_WINDOW_DAYS);
}

/**
 * The history the free tier promises: seven Chore Dates (docs/spec/01-product.md, Tiers —
 * "history: 7 days"). M3's `full_history` gate extends the same window backwards; nothing
 * gates this one.
 */
export const HISTORY_WINDOW_DAYS = 7;

/**
 * The seven Chore Dates ending on `today`, oldest first. Oldest first is the order the grid's
 * columns are built in, so a right-to-left reader gets the newest day at the near edge without
 * anything reversing the array.
 */
export function historyWindow(today: IsoDate): IsoDate[] {
  return Array.from({ length: HISTORY_WINDOW_DAYS }, (_, i) =>
    addDays(today, i - (HISTORY_WINDOW_DAYS - 1)),
  );
}
