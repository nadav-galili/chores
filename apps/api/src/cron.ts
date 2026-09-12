import { remindersDue, rolloversDue, type DueReminder, type DueRollover } from '@chores/shared';
import { eq, isNotNull } from 'drizzle-orm';
import type { Db } from './db/client.ts';
import { children, households } from './db/schema.ts';
import { writeHouseholdInstances } from './materialize.ts';
import { readReceipts, sendImmediates, sendReminder, type DueImmediate } from './notifications.ts';
import type { Push } from './push.ts';

/**
 * The minute cron inside the API process (docs/spec/01-product.md, notifications). Every household
 * runs on its own clock, so each tick asks what has just passed in each of them: a day boundary,
 * whose new day is materialized, and a child's reminder time, which is sent by `notifications.ts`.
 *
 * `now` is a parameter, so the whole of it is a fixed clock away from being a test.
 */

export const TICK_MS = 60_000;

export type TickResult = {
  rolled: DueRollover[];
  /** The reminders this tick claimed; a reminder another tick already handled is not one. */
  reminded: DueReminder[];
  /** The immediate kinds this tick claimed: a request waiting on a parent, an approval on a child. */
  announced: DueImmediate[];
  /** Tokens forgotten this tick because Expo said the device is gone. */
  forgotten: number;
};

/** One minute of the cron's work. Idempotent: every write it does is claimed by a fixed id. */
export async function runTick(db: Db, push: Push, now = new Date()): Promise<TickResult> {
  const householdRows = await db
    .select({ id: households.id, tz: households.tz, day_boundary_hour: households.dayBoundaryHour })
    .from(households);

  const rolled = rolloversDue(householdRows, now);
  for (const rollover of rolled) {
    await writeHouseholdInstances(db, rollover.household_id, rollover.chore_date);
  }

  const childRows = await db
    .select({
      id: children.id,
      reminder_time: children.reminderTime,
      tz: households.tz,
      day_boundary_hour: households.dayBoundaryHour,
    })
    .from(children)
    .innerJoin(households, eq(households.id, children.householdId))
    .where(isNotNull(children.reminderTime));

  const reminded: DueReminder[] = [];
  let forgotten = 0;
  for (const due of remindersDue(childRows, now)) {
    const sent = await sendReminder(db, push, due, now);
    if (sent.forgotten) forgotten++;
    if (sent.claimed) reminded.push(due);
  }
  // Nothing on a clock asks for these two; the tick is only where the claim row lives.
  const immediate = await sendImmediates(db, push, now);
  forgotten += immediate.forgotten;
  forgotten += await readReceipts(db, push, now);

  return { rolled, reminded, announced: immediate.announced, forgotten };
}

/** Starts the minute cron; returns the stop the process never calls but a test might. */
export function startCron(db: Db, push: Push): () => void {
  const timer = setInterval(() => {
    void runTick(db, push).catch((e: unknown) => console.error('cron tick failed', e));
  }, TICK_MS);
  return () => clearInterval(timer);
}
