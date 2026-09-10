import type { IsoDate } from '@chores/shared';
import { eq } from 'drizzle-orm';
import { analyticsState } from '@/db/schema';
import type { DeviceDb } from '@/db/types';

/**
 * What this device has already reported (ADR-0009). Every question the milestone asks is about a
 * day or about a threshold — did this child open the app today, did they finish the day, did the
 * grove grow — and the screens run their reads on every open, every focus and after every tap. So
 * the deduping lives here, in SQLite, where a relaunch cannot forget it.
 *
 * Nothing here sends anything: each function answers whether the event is news, and the caller
 * captures it if it is.
 */

const STATE_ROW = 1;

async function held(db: DeviceDb) {
  const [row] = await db.select().from(analyticsState).where(eq(analyticsState.id, STATE_ROW));
  return row;
}

async function record(
  db: DeviceDb,
  fields: { opened_on?: string; completed_on?: string; grove_stage?: number },
) {
  await db
    .insert(analyticsState)
    .values({ id: STATE_ROW, ...fields })
    .onConflictDoUpdate({ target: analyticsState.id, set: fields });
}

/**
 * Whether `today` is news for one of the daily events. A chore date already reported is not — and
 * neither is an earlier one, which is what a household moving its day boundary backwards, or a
 * phone whose clock slipped, would otherwise produce.
 */
async function markDate(
  db: DeviceDb,
  field: 'opened_on' | 'completed_on',
  today: IsoDate,
): Promise<boolean> {
  const last = (await held(db))?.[field];
  if (last != null && last >= today) return false;
  await record(db, { [field]: today });
  return true;
}

/** Whether this is the first open on `today`. Retention is counted in days, not in launches. */
export function markOpen(db: DeviceDb, today: IsoDate): Promise<boolean> {
  return markDate(db, 'opened_on', today);
}

/** Whether this day's completion is news: once per chore date, however often it is read. */
export function markDayComplete(db: DeviceDb, today: IsoDate): Promise<boolean> {
  return markDate(db, 'completed_on', today);
}

/**
 * Whether the grove has grown past what was last reported. The first stage a device ever reads is
 * the grove it inherited, not a growth, so it is recorded silently — otherwise a phone rejoining a
 * household would report every tree the child ever grew as growing again today. After that, a
 * stage that has not moved is not a growth, and one that reads lower is not a shrink: a tree is
 * never taken back (ADR-0011).
 */
export async function markGroveStage(db: DeviceDb, stage: number): Promise<boolean> {
  const reported = (await held(db))?.grove_stage;
  if (reported != null && stage <= reported) return false;
  await record(db, { grove_stage: stage });
  return reported != null;
}
