import {
  digestCopy,
  digestWorthSending,
  kidReminderCopy,
  notificationId,
  type DigestSummary,
  type DueDigest,
  type DueReminder,
  type IsoDate,
  type NotificationKind,
  type NotificationTarget,
} from '@chores/shared';
import { and, asc, desc, eq, isNotNull, isNull, lt, sql } from 'drizzle-orm';
import type { Db } from './db/client.ts';
import {
  childDevices,
  children,
  choreInstances,
  notifications,
  parentDevices,
  parents,
  redemptions,
} from './db/schema.ts';
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

type Claim = {
  id: string;
  target: NotificationTarget;
  targetId: string | null;
  kind: NotificationKind;
  payload: Record<string, unknown>;
};

/**
 * Claims one notification, and answers whether this tick is the one that has to send it. The id is
 * deterministic, so the insert is the lock: a second tick, or the tick after a restart, finds the
 * row taken. The one exception is a row a previous tick recorded a transient failure on — that
 * one is known not to have been delivered, so it is tried again while it is still worth
 * delivering. `DeviceNotRegistered` is terminal: there is nothing left to try it on.
 */
async function claimNotification(db: Db, claim: Claim, now: Date): Promise<boolean> {
  const claimed = await db
    .insert(notifications)
    .values({ ...claim, scheduledFor: now })
    .onConflictDoNothing()
    .returning({ id: notifications.id });
  if (claimed.length) return true;

  const [held] = await db
    .select({ sentAt: notifications.sentAt, payload: notifications.payload })
    .from(notifications)
    .where(eq(notifications.id, claim.id));
  const failure = held?.payload['error'];
  return held?.sentAt === null && typeof failure === 'string' && failure !== 'DeviceNotRegistered';
}

/** Pushes one claimed notification and records what Expo said, token included if it is dead. */
async function deliver(
  db: Db,
  push: Push,
  id: string,
  target: NotificationTarget,
  device: { id: string },
  message: PushMessage,
  now: Date,
): Promise<Sent> {
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
    await forgetToken(db, target, device.id);
    return { claimed: true, forgotten: true };
  }
  return { claimed: true, forgotten: false };
}

/**
 * Pushes one due reminder, if the child's device has a token. Without one the row is still
 * recorded and nothing is sent: the device's own local notification is the delivery, which is
 * what a child with no push credentials, or no network at their last open, gets.
 */
export async function sendReminder(db: Db, push: Push, due: DueReminder, now: Date): Promise<Sent> {
  const device = await pushableDevice(db, due.child_id);
  const id = reminderIdOf(due);
  const claim: Claim = {
    id,
    target: 'child_device',
    targetId: device?.id ?? null,
    kind: 'kid_reminder',
    payload: {
      child_id: due.child_id,
      chore_date: due.chore_date,
      reminder_time: due.reminder_time,
    },
  };
  if (!(await claimNotification(db, claim, now))) return { claimed: false, forgotten: false };
  if (!device?.token) return { claimed: true, forgotten: false };

  return deliver(
    db,
    push,
    id,
    'child_device',
    device,
    {
      to: device.token,
      ...kidReminderCopy(device.locale),
      data: { child_id: due.child_id, chore_date: due.chore_date },
    },
    now,
  );
}

/** The device a parent's digest goes to: their newest registration that still has a token. */
async function pushableParentDevice(db: Db, parentId: string) {
  const [device] = await db
    .select({
      id: parentDevices.id,
      token: parentDevices.expoPushToken,
      locale: parentDevices.locale,
    })
    .from(parentDevices)
    .where(and(eq(parentDevices.parentId, parentId), isNotNull(parentDevices.expoPushToken)))
    .orderBy(desc(parentDevices.lastSeenAt))
    .limit(1);
  return device;
}

/**
 * What the digest says about one household's open Chore Date. Every number is counted here and
 * none is stored (ADR-0002): due and done come off the Instances of that date, and Day Complete
 * is derived from the two. `day_summaries` is not read, because it only exists once a child has
 * completed something — a day with four chores and no taps has no row there at all.
 */
async function digestSummary(
  db: Db,
  householdId: string,
  choreDate: IsoDate,
): Promise<DigestSummary> {
  const [childRows, waiting] = await Promise.all([
    db
      .select({
        firstName: children.firstName,
        dueCount: sql<number>`count(${choreInstances.id})::int`,
        // The Instance status is what counts as done, exactly as the parent's today screen has it.
        doneCount: sql<number>`(count(${choreInstances.id}) filter (where ${choreInstances.status} = 'done'))::int`,
      })
      .from(children)
      .leftJoin(
        choreInstances,
        and(
          eq(choreInstances.childId, children.id),
          eq(choreInstances.choreDate, choreDate),
          eq(choreInstances.householdId, householdId),
        ),
      )
      .where(eq(children.householdId, householdId))
      .groupBy(children.id, children.firstName, children.sort)
      .orderBy(asc(children.sort)),
    // Every Redemption nobody has decided, whatever day it was asked for: a request does not
    // expire with the Chore Date, and the digest is where a parent is reminded it is still there.
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(redemptions)
      .where(and(eq(redemptions.householdId, householdId), eq(redemptions.status, 'requested'))),
  ]);

  return {
    children: childRows.map((row) => ({
      first_name: row.firstName,
      due_count: row.dueCount,
      done_count: row.doneCount,
    })),
    undecided_redemptions: waiting[0]?.count ?? 0,
  };
}

export type DigestSent = { claimed: boolean; forgotten: number };

/**
 * One digest per parent of a household, about the Chore Date that is still open. Suppression is
 * decided before anything is claimed: a day with nothing due and nothing waiting writes no row at
 * all, so a chore that becomes due at 21:00 is not silenced by the 20:00 tick having spent the
 * claim. The claim is per parent and day (`uuid5('notif','parent_digest', parent_id, chore_date)`),
 * so however many ticks the window gives, each parent is told once — and each in the locale their
 * own device registered, which is how two parents get the same evening in two languages.
 */
export async function sendDigest(
  db: Db,
  push: Push,
  due: DueDigest,
  now: Date,
): Promise<DigestSent> {
  const summary = await digestSummary(db, due.household_id, due.chore_date);
  if (!digestWorthSending(summary)) return { claimed: false, forgotten: 0 };

  const parentRows = await db
    .select({ id: parents.id })
    .from(parents)
    .where(eq(parents.householdId, due.household_id))
    .orderBy(asc(parents.createdAt));

  let claimed = false;
  let forgotten = 0;
  for (const parent of parentRows) {
    // A parent with two phones is one claim row, which holds one `target_id`, so the digest goes
    // to the newest registration — the same rule a child's reminder follows — and receipts keep
    // naming the device that was actually pushed to.
    const device = await pushableParentDevice(db, parent.id);
    const id = notificationId('parent_digest', parent.id, due.chore_date);
    const claim: Claim = {
      id,
      target: 'parent_device',
      targetId: device?.id ?? null,
      kind: 'parent_digest',
      payload: { parent_id: parent.id, chore_date: due.chore_date },
    };
    if (!(await claimNotification(db, claim, now))) continue;
    claimed = true;
    // No token is not an error: the row is the record that this parent's evening was accounted
    // for, and a phone that has never registered has nowhere to be pushed to.
    if (!device?.token) continue;

    const sent = await deliver(
      db,
      push,
      id,
      'parent_device',
      device,
      {
        to: device.token,
        ...digestCopy(device.locale, summary),
        // A payload carries ids, never state: the app opens the day and pulls the truth (#37).
        data: { chore_date: due.chore_date },
      },
      now,
    );
    if (sent.forgotten) forgotten++;
  }
  return { claimed, forgotten };
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
