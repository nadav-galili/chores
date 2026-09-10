import { uuid7, type Locale } from '@chores/shared';
import { eq } from 'drizzle-orm';
import { notificationState, outbox } from '@/db/schema';
import type { DeviceDb } from '@/db/types';
import { inTransaction } from './engine';
import { enqueueOp } from './outbox';

/**
 * What this device has arranged about its reminder (docs/spec/01-product.md, notifications): the
 * push token the server has been told about, and the wall-clock time the OS has been asked to fire
 * at. Both are compared with what is wanted before anything happens, so the work runs on every
 * open and does something only when something moved. Nothing here talks to the OS or the network:
 * the scheduler is passed in, and the token registration leaves as an outbox op like any write.
 */

const STATE_ROW = 1;

async function held(db: DeviceDb) {
  const [row] = await db
    .select()
    .from(notificationState)
    .where(eq(notificationState.id, STATE_ROW));
  return row;
}

async function record(
  db: DeviceDb,
  fields: { push_token?: string | null; locale?: Locale | null; reminder_time?: string | null },
  now: Date,
) {
  await db
    .insert(notificationState)
    .values({ id: STATE_ROW, ...fields, updated_at: now.toISOString() })
    .onConflictDoUpdate({
      target: notificationState.id,
      set: { ...fields, updated_at: now.toISOString() },
    });
}

/**
 * What the server has to know to push to this device: the token, and the language to push in.
 */
export type PushRegistration = { token: string; locale: Locale };

/**
 * Tells the server about a push token it does not have yet, as one outbox op. The device re-reads
 * its token on every open because a token rots, so this is called far more often than it queues
 * anything. A phone that changed language registers again with the same token, so the reminder
 * arrives in the language the child now reads. Returns whether an op was queued.
 */
export async function registerPushToken(
  db: DeviceDb,
  { token, locale }: PushRegistration,
  now: Date,
): Promise<boolean> {
  const known = await held(db);
  if (known?.push_token === token && known.locale === locale) return false;
  await inTransaction(db, async () => {
    await enqueueOp(
      db,
      {
        op_id: uuid7(),
        type: 'register_push_token',
        payload: { expo_push_token: token, locale },
      },
      now,
    );
    await record(db, { push_token: token, locale }, now);
  });
  return true;
}

/**
 * Whether the server is known to hold this device's push token: it has been registered and the op
 * carrying it has been acked. Until then the reminder has to stay a local notification — a token
 * sitting in the outbox is one the cron cannot push to (docs/spec/01-product.md, notifications).
 */
export async function serverHoldsToken(db: DeviceDb): Promise<boolean> {
  if (!(await held(db))?.push_token) return false;
  const queued = await db
    .select({ op_id: outbox.op_id })
    .from(outbox)
    .where(eq(outbox.type, 'register_push_token'));
  return queued.length === 0;
}

/**
 * Forgets that the server was told about this device's token. Nothing optimistic to undo: what
 * this repairs is the device's belief, so the next open registers the token again.
 */
export async function forgetRegisteredToken(db: DeviceDb, now: Date): Promise<void> {
  await record(db, { push_token: null }, now);
}

/** Asks the OS to fire the reminder at a wall-clock `HH:MM`, or to stop firing it at all. */
export type ReminderScheduler = (time: string | null) => Promise<void>;

/**
 * Keeps the local notification on the reminder time the parent set. The reminder is the child's
 * fallback delivery — the server only pushes when this device has a token — so it is rescheduled
 * whenever the time moves and cancelled when the parent clears it. Recorded only once the OS has
 * accepted it, so a refused schedule is retried on the next open.
 */
export async function scheduleReminder(
  db: DeviceDb,
  reminderTime: string | null,
  schedule: ReminderScheduler,
  now: Date,
): Promise<boolean> {
  const row = await held(db);
  if ((row?.reminder_time ?? null) === reminderTime) return false;
  await schedule(reminderTime);
  await record(db, { reminder_time: reminderTime }, now);
  return true;
}
