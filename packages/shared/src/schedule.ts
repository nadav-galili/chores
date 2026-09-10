import { choreDate, type IsoDate } from './chore-date.ts';
import { localTimeSchema } from './child.ts';

/**
 * When the server has to act on a household's clock: the day boundary passing, and a child's
 * reminder time arriving (docs/spec/01-product.md, notifications). Pure functions over an
 * instant, so the cron is a fixed clock away from being a test.
 */

const MINUTE_MS = 60_000;
const MINUTES_PER_DAY = 24 * 60;

/** The ticks a minute cron gets to notice something: one, plus four in case the process was down. */
export const TICK_WINDOW_MINUTES = 5;

const formatters = new Map<string, Intl.DateTimeFormat>();
const offsetFormatters = new Map<string, Intl.DateTimeFormat>();

function clockFor(tz: string): Intl.DateTimeFormat {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    });
    formatters.set(tz, f);
  }
  return f;
}

export type LocalTime = { hour: number; minute: number };

/** `HH:MM` as its parts. Throws on anything else: a stored reminder time is validated on write. */
export function parseLocalTime(time: string): LocalTime {
  const parsed = localTimeSchema.parse(time);
  const [hour, minute] = parsed.split(':').map(Number) as [number, number];
  return { hour, minute };
}

/** Minutes past local midnight, 0–1439, of `instant` in `tz`. */
export function localMinutes(instant: Date, tz: string): number {
  const parts = clockFor(tz).formatToParts(instant);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((p) => p.type === type)?.value ?? '0');
  return get('hour') * 60 + get('minute');
}

/** Minutes since the wall clock in `tz` last read `time`, wrapped forward into 0–1439. */
export function minutesSinceLocalTime(instant: Date, tz: string, time: string): number {
  const { hour, minute } = parseLocalTime(time);
  return (localMinutes(instant, tz) - (hour * 60 + minute) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
}

export type RollingHousehold = { id: string; tz: string; day_boundary_hour: number };
export type DueRollover = { household_id: string; chore_date: IsoDate };

/**
 * The households whose chore date changed within the last `window` minutes, and the date that is
 * now theirs. Read as a change between two instants rather than as a wall clock, so a boundary hour
 * a DST spring-forward skips is still crossed exactly once.
 */
export function rolloversDue(
  households: readonly RollingHousehold[],
  now: Date,
  window = TICK_WINDOW_MINUTES,
): DueRollover[] {
  const before = new Date(now.getTime() - window * MINUTE_MS);
  const due: DueRollover[] = [];
  for (const h of households) {
    const date = choreDate(now, h.tz, h.day_boundary_hour);
    if (date !== choreDate(before, h.tz, h.day_boundary_hour)) {
      due.push({ household_id: h.id, chore_date: date });
    }
  }
  return due;
}

export type ReminderChild = {
  id: string;
  tz: string;
  day_boundary_hour: number;
  /** Household-local `HH:MM`; null means this child gets no reminder. */
  reminder_time: string | null;
};
export type DueReminder = { child_id: string; chore_date: IsoDate; reminder_time: string };

/**
 * The children whose reminder time passed within the last `window` minutes, each with the chore
 * date the reminder is about. A reminder is a wall-clock promise, so it is read as one: an hour a
 * DST spring-forward removes takes that day's reminder with it.
 */
export function remindersDue(
  children: readonly ReminderChild[],
  now: Date,
  window = TICK_WINDOW_MINUTES,
): DueReminder[] {
  const due: DueReminder[] = [];
  for (const child of children) {
    const time = child.reminder_time;
    if (!time) continue;
    if (minutesSinceLocalTime(now, child.tz, time) >= window) continue;
    due.push({
      child_id: child.id,
      chore_date: choreDate(now, child.tz, child.day_boundary_hour),
      reminder_time: time,
    });
  }
  return due;
}

function offsetClockFor(tz: string): Intl.DateTimeFormat {
  let f = offsetFormatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    });
    offsetFormatters.set(tz, f);
  }
  return f;
}

/** Minutes east of UTC that `tz` is at `instant`, DST included. */
export function zoneOffsetMinutes(tz: string, instant: Date): number {
  const parts = offsetClockFor(tz).formatToParts(instant);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((p) => p.type === type)?.value ?? '0');
  const asUtc = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour'),
    get('minute'),
    get('second'),
  );
  return Math.round((asUtc - instant.getTime()) / MINUTE_MS);
}

/** The zone this machine is in. On a kid device, wherever the child happens to be. */
export const deviceTimeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

/**
 * The wall clock on `here` that is the same moment as `time` in `tz`. A reminder time is a
 * household-local promise, but a device schedules on its own clock, so a child travelling out of
 * the household's zone is still nudged at the hour their parent set. Read at `now`, so a DST
 * change between the zones is picked up the next time this is called.
 */
export function localTimeFor(
  time: string,
  tz: string,
  now = new Date(),
  here = deviceTimeZone(),
): LocalTime {
  const { hour, minute } = parseLocalTime(time);
  const shifted = hour * 60 + minute - zoneOffsetMinutes(tz, now) + zoneOffsetMinutes(here, now);
  const minutes = ((shifted % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  return { hour: Math.floor(minutes / 60), minute: minutes % 60 };
}
