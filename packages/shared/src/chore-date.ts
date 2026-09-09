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
