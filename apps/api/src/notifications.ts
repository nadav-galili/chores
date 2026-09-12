import {
  kidReminderCopy,
  notificationId,
  redemptionRequestedCopy,
  rewardApprovedCopy,
  type DueReminder,
  type NotificationKind,
  type NotificationTarget,
} from '@chores/shared';
import { and, desc, eq, gte, isNotNull, isNull, lt, sql } from 'drizzle-orm';
import type { Db } from './db/client.ts';
import { childDevices, notifications, parentDevices, parents, redemptions } from './db/schema.ts';
import type { Push, PushError, PushMessage, PushSend } from './push.ts';

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
 * Claims one notification, and answers whether this tick is the one that has to send it. The id
 * is deterministic, so the insert is the lock: a second tick, or the tick after a restart, finds
 * the row taken. The one exception is a row a previous tick recorded a transient failure on —
 * that one is known not to have been delivered, so it is tried again while it is still worth
 * delivering. `DeviceNotRegistered` is not transient: the token is already forgotten.
 */
async function claimNotification(
  db: Db,
  row: {
    id: string;
    target: NotificationTarget;
    targetId: string | null;
    kind: NotificationKind;
    payload: Record<string, unknown>;
  },
  now: Date,
): Promise<boolean> {
  const claimed = await db
    .insert(notifications)
    .values({ ...row, scheduledFor: now })
    .onConflictDoNothing()
    .returning({ id: notifications.id });
  if (claimed.length) return true;

  const [held] = await db
    .select({ sentAt: notifications.sentAt, payload: notifications.payload })
    .from(notifications)
    .where(eq(notifications.id, row.id));
  const failure = held?.payload['error'];
  return held?.sentAt === null && typeof failure === 'string' && failure !== 'DeviceNotRegistered';
}

const claimReminder = (
  db: Db,
  due: DueReminder,
  now: Date,
  device: { id: string } | undefined,
): Promise<boolean> =>
  claimNotification(
    db,
    {
      id: reminderIdOf(due),
      target: 'child_device',
      targetId: device?.id ?? null,
      kind: 'kid_reminder',
      payload: {
        child_id: due.child_id,
        chore_date: due.chore_date,
        reminder_time: due.reminder_time,
      },
    },
    now,
  );

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
  const results = await push.send([message]);
  const forgotten = await recordSends(
    db,
    reminderIdOf(due),
    'child_device',
    [{ device, result: results[0] }],
    now,
  );
  return { claimed: true, forgotten: forgotten > 0 };
}

/**
 * Writes down what Expo said about one claim row's sends, and answers how many tokens that cost.
 * A notification can go to more than one device — a parent has a phone and a tablet, and one
 * claim row is what makes it one notification — so the row records the first device that took it,
 * which is the one a receipt can later be traded against. A device Expo refuses is forgotten
 * whatever the others answered, and a row nothing got through to keeps the failure in its payload
 * so the next tick knows whether to try again.
 */
async function recordSends(
  db: Db,
  id: string,
  target: NotificationTarget,
  attempts: readonly { device: { id: string }; result: PushSend | undefined }[],
  now: Date,
): Promise<number> {
  const delivered = attempts.find((a) => a.result?.ok);
  if (delivered?.result?.ok) {
    await db
      .update(notifications)
      .set({ sentAt: now, ticket: delivered.result.ticket, targetId: delivered.device.id })
      .where(eq(notifications.id, id));
  } else {
    const first = attempts[0]?.result;
    const error: PushError = first && !first.ok ? first.error : 'other';
    await db
      .update(notifications)
      .set({ payload: sql`${notifications.payload} || ${JSON.stringify({ error })}::jsonb` })
      .where(eq(notifications.id, id));
  }

  let forgotten = 0;
  for (const attempt of attempts) {
    if (attempt.result?.ok === false && attempt.result.error === 'DeviceNotRegistered') {
      await forgetToken(db, target, attempt.device.id);
      forgotten++;
    }
  }
  return forgotten;
}

/**
 * The two kinds nothing on a clock asks for: a child asked for a reward, or a parent decided one
 * (docs/spec/01-product.md, notifications). The tick is still what sends them — the claim row is
 * the exactly-once mechanism and a route has no business owning one — so each tick asks which
 * redemptions are waiting on a notification rather than being told.
 */
export type DueImmediate = {
  kind: 'redemption_requested' | 'reward_approved';
  redemption_id: string;
  /** The parent or child the notification is for: the key half of its deterministic id. */
  subject_id: string;
};

/**
 * How far back a decided redemption is looked at. An undecided one bounds its own scan — there
 * are only ever a few, and the digest counts them — but an approved one stays approved forever,
 * and an approval nobody heard about within the hour is not news any more.
 */
export const IMMEDIATE_CATCHUP_MS = 60 * 60_000;

/** Every device of this parent's that has a token, newest first. A phone and a tablet both count. */
async function pushableParentDevices(db: Db, parentId: string) {
  return db
    .select({
      id: parentDevices.id,
      token: parentDevices.expoPushToken,
      locale: parentDevices.locale,
    })
    .from(parentDevices)
    .where(and(eq(parentDevices.parentId, parentId), isNotNull(parentDevices.expoPushToken)))
    .orderBy(desc(parentDevices.lastSeenAt));
}

/**
 * A redemption request is the one interrupt this app sends a parent: it is the only thing that
 * leaves a child waiting on them, so it goes to every device each parent of the household has.
 * One claim row per parent — the id the spec fixes is `(redemption, parent)` — which is what
 * makes a phone and a tablet one notification rather than two.
 */
async function sendRequests(db: Db, push: Push, now: Date) {
  const waiting = await db
    .select({
      redemptionId: redemptions.id,
      householdId: redemptions.householdId,
      parentId: parents.id,
    })
    .from(redemptions)
    .innerJoin(parents, eq(parents.householdId, redemptions.householdId))
    .where(eq(redemptions.status, 'requested'));

  const announced: DueImmediate[] = [];
  let forgotten = 0;
  for (const row of waiting) {
    const id = notificationId('redemption_requested', row.redemptionId, row.parentId);
    const devices = await pushableParentDevices(db, row.parentId);
    const claimed = await claimNotification(
      db,
      {
        id,
        target: 'parent_device',
        targetId: devices[0]?.id ?? null,
        kind: 'redemption_requested',
        payload: { redemption_id: row.redemptionId, parent_id: row.parentId },
      },
      now,
    );
    if (!claimed) continue;
    announced.push({
      kind: 'redemption_requested',
      redemption_id: row.redemptionId,
      subject_id: row.parentId,
    });
    // A parent with no device is not an error: the row stands unsent, and the request is still
    // there on the today screen whenever they next open the app.
    if (!devices.length) continue;

    const results = await push.send(
      devices.map((device): PushMessage => ({
        to: device.token!,
        ...redemptionRequestedCopy(device.locale),
        // A kind, ids and a destination. A payload may carry copy and must never carry state:
        // a device that got this and then failed to sync would otherwise show a lie.
        data: {
          kind: 'redemption_requested',
          household_id: row.householdId,
          redemption_id: row.redemptionId,
          path: '/(parent)',
        },
      })),
    );
    forgotten += await recordSends(
      db,
      id,
      'parent_device',
      devices.map((device, i) => ({ device, result: results[i] })),
      now,
    );
  }
  return { announced, forgotten };
}

/** An approval is told to the child straight away, on their newest live device with a token. */
async function sendApprovals(db: Db, push: Push, now: Date) {
  const decided = await db
    .select({ redemptionId: redemptions.id, childId: redemptions.childId })
    .from(redemptions)
    .where(
      and(
        eq(redemptions.status, 'approved'),
        gte(redemptions.decidedAt, new Date(now.getTime() - IMMEDIATE_CATCHUP_MS)),
      ),
    );

  const announced: DueImmediate[] = [];
  let forgotten = 0;
  for (const row of decided) {
    const id = notificationId('reward_approved', row.redemptionId, row.childId);
    const device = await pushableDevice(db, row.childId);
    const claimed = await claimNotification(
      db,
      {
        id,
        target: 'child_device',
        targetId: device?.id ?? null,
        kind: 'reward_approved',
        payload: { redemption_id: row.redemptionId, child_id: row.childId },
      },
      now,
    );
    if (!claimed) continue;
    announced.push({
      kind: 'reward_approved',
      redemption_id: row.redemptionId,
      subject_id: row.childId,
    });
    if (!device?.token) continue;

    const results = await push.send([
      {
        to: device.token,
        ...rewardApprovedCopy(device.locale),
        data: {
          kind: 'reward_approved',
          child_id: row.childId,
          redemption_id: row.redemptionId,
          path: '/(kid)/shop',
        },
      },
    ]);
    forgotten += await recordSends(db, id, 'child_device', [{ device, result: results[0] }], now);
  }
  return { announced, forgotten };
}

/** Both immediate kinds, for one tick. */
export async function sendImmediates(
  db: Db,
  push: Push,
  now: Date,
): Promise<{ announced: DueImmediate[]; forgotten: number }> {
  const requests = await sendRequests(db, push, now);
  const approvals = await sendApprovals(db, push, now);
  return {
    announced: [...requests.announced, ...approvals.announced],
    forgotten: requests.forgotten + approvals.forgotten,
  };
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
