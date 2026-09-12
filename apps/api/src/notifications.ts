import {
  kidReminderCopy,
  notificationId,
  type DueReminder,
  type NotificationTarget,
} from '@chores/shared';
import { and, desc, eq, isNotNull, isNull, lt, sql } from 'drizzle-orm';
import type { Db } from './db/client.ts';
import { childDevices, notifications, parentDevices } from './db/schema.ts';
import type { Push, PushError, PushMessage } from './push.ts';

/**
 * Sending a notification, and living with what Expo says about it (docs/spec/01-product.md,
 * notifications). Every send is claimed by a deterministic row first, so however many ticks come
 * past — including the first after a restart — a child is nudged once.
 */

/** Expo answers for a ticket minutes after it issues it; asking sooner just gets nothing back. */
export const RECEIPT_DELAY_MS = 15 * 60_000;

/** Receipts per tick. A household-scale app never has a backlog; a bad day must not stall one. */
const RECEIPT_BATCH = 100;

export type Sent = { claimed: boolean; forgotten: boolean };

const reminderIdOf = (due: DueReminder) =>
  notificationId('kid_reminder', due.child_id, due.chore_date);

/**
 * A token Expo refuses is dead: forget it, so nothing is sent to it again (M1 risks). A child and
 * a parent keep their devices in separate tables, so the notification's `target` is what says
 * which of the two the id belongs to — guessing by trying both would null a stranger's row.
 */
export async function forgetToken(
  db: Db,
  target: NotificationTarget,
  deviceId: string,
): Promise<void> {
  if (target === 'parent_device') {
    await db
      .update(parentDevices)
      .set({ expoPushToken: null })
      .where(eq(parentDevices.id, deviceId));
    return;
  }
  await db.update(childDevices).set({ expoPushToken: null }).where(eq(childDevices.id, deviceId));
}

/** The device a child's reminder goes to: their newest live device that has a token. */
async function pushableDevice(db: Db, childId: string) {
  const [device] = await db
    .select({
      id: childDevices.id,
      token: childDevices.expoPushToken,
      locale: childDevices.locale,
    })
    .from(childDevices)
    .where(
      and(
        eq(childDevices.childId, childId),
        isNull(childDevices.revokedAt),
        isNotNull(childDevices.expoPushToken),
      ),
    )
    .orderBy(desc(childDevices.lastSeenAt))
    .limit(1);
  return device;
}

/**
 * Claims one reminder, and answers whether this tick is the one that has to send it. The id is
 * deterministic, so the insert is the lock: a second tick, or the tick after a restart, finds the
 * row taken. The one exception is a row a previous tick recorded a transient failure on — that
 * one is known not to have been delivered, so it is tried again while the reminder is still worth
 * delivering.
 */
async function claimReminder(
  db: Db,
  due: DueReminder,
  now: Date,
  device: { id: string } | undefined,
): Promise<boolean> {
  const id = reminderIdOf(due);
  const claimed = await db
    .insert(notifications)
    .values({
      id,
      target: 'child_device',
      targetId: device?.id ?? null,
      kind: 'kid_reminder',
      payload: {
        child_id: due.child_id,
        chore_date: due.chore_date,
        reminder_time: due.reminder_time,
      },
      scheduledFor: now,
    })
    .onConflictDoNothing()
    .returning({ id: notifications.id });
  if (claimed.length) return true;

  const [held] = await db
    .select({ sentAt: notifications.sentAt, payload: notifications.payload })
    .from(notifications)
    .where(eq(notifications.id, id));
  const failure = held?.payload['error'];
  return held?.sentAt === null && typeof failure === 'string' && failure !== 'DeviceNotRegistered';
}

/**
 * Pushes one due reminder, if the child's device has a token. Without one the row is still
 * recorded and nothing is sent: the device's own local notification is the delivery, which is
 * what a child with no push credentials, or no network at their last open, gets.
 */
export async function sendReminder(db: Db, push: Push, due: DueReminder, now: Date): Promise<Sent> {
  const device = await pushableDevice(db, due.child_id);
  if (!(await claimReminder(db, due, now, device))) return { claimed: false, forgotten: false };
  if (!device?.token) return { claimed: true, forgotten: false };

  const message: PushMessage = {
    to: device.token,
    ...kidReminderCopy(device.locale),
    data: { child_id: due.child_id, chore_date: due.chore_date },
  };
  const id = reminderIdOf(due);
  const [result] = await push.send([message]);
  if (result?.ok) {
    await db
      .update(notifications)
      .set({ sentAt: now, ticket: result.ticket, targetId: device.id })
      .where(eq(notifications.id, id));
    return { claimed: true, forgotten: false };
  }

  const error: PushError = result?.error ?? 'other';
  await db
    .update(notifications)
    .set({ payload: sql`${notifications.payload} || ${JSON.stringify({ error })}::jsonb` })
    .where(eq(notifications.id, id));
  if (error === 'DeviceNotRegistered') {
    await forgetToken(db, 'child_device', device.id);
    return { claimed: true, forgotten: true };
  }
  return { claimed: true, forgotten: false };
}

/**
 * Trades the tickets old enough to have an answer for their receipts. A receipt is where
 * `DeviceNotRegistered` usually turns up: the send looked fine and the delivery did not.
 * Returns how many tokens that cost.
 */
export async function readReceipts(db: Db, push: Push, now: Date): Promise<number> {
  const rows = await db
    .select({
      id: notifications.id,
      ticket: notifications.ticket,
      target: notifications.target,
      targetId: notifications.targetId,
    })
    .from(notifications)
    .where(
      and(
        isNotNull(notifications.ticket),
        lt(notifications.sentAt, new Date(now.getTime() - RECEIPT_DELAY_MS)),
        sql`${notifications.payload}->>'receipt' is null`,
      ),
    )
    .limit(RECEIPT_BATCH);
  if (!rows.length) return 0;

  const receipts = await push.receipts(rows.map((r) => r.ticket!));
  let forgotten = 0;
  for (const row of rows) {
    const receipt = receipts[row.ticket!];
    if (!receipt) continue;
    const value = receipt.ok ? 'ok' : receipt.error;
    await db
      .update(notifications)
      .set({
        payload: sql`${notifications.payload} || ${JSON.stringify({ receipt: value })}::jsonb`,
      })
      .where(eq(notifications.id, row.id));
    if (!receipt.ok && receipt.error === 'DeviceNotRegistered' && row.targetId) {
      await forgetToken(db, row.target, row.targetId);
      forgotten++;
    }
  }
  return forgotten;
}
