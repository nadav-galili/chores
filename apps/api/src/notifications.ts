import {
  digestCopy,
  digestWorthSending,
  kidReminderCopy,
  notificationId,
  redemptionRequestedCopy,
  rewardApprovedCopy,
  type DigestSummary,
  type DueDigest,
  type DueReminder,
  type IsoDate,
  type NotificationKind,
  type NotificationPath,
  type NotificationTarget,
} from '@chores/shared';
import { and, asc, desc, eq, gte, isNotNull, isNull, lt, sql } from 'drizzle-orm';
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

type Claim = {
  id: string;
  target: NotificationTarget;
  targetId: string | null;
  kind: NotificationKind;
  payload: Record<string, unknown>;
};

/**
 * Claims one notification, and answers whether this tick is the one that has to send it. The id
 * is deterministic, so the insert is the lock: a second tick, or the tick after a restart, finds
 * the row taken. The one exception is a row a previous tick recorded a transient failure on —
 * that one is known not to have been delivered, so it is tried again while it is still worth
 * delivering. `DeviceNotRegistered` is not transient, it is terminal: the token is already
 * forgotten, so there is nothing left to try it on.
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
        //
        // The destination is the parent's day with this redemption named, which is where a
        // request is decided; the id beside it is what makes the tap land on the request rather
        // than on the screen in general (#51).
        data: {
          kind: 'redemption_requested',
          household_id: row.householdId,
          redemption_id: row.redemptionId,
          path: '/(parent)' satisfies NotificationPath,
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
          path: '/(kid)/shop' satisfies NotificationPath,
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

    const results = await push.send([
      {
        to: device.token,
        ...digestCopy(device.locale, summary),
        // A payload carries ids, never state: the app opens the day and pulls the truth (#37).
        // The kind is what a tap reports to analytics (#54) and the path is where it lands: the
        // parent's own day, which is the Chore Date this digest is about and the only one that
        // screen ever shows.
        data: {
          kind: 'parent_digest',
          chore_date: due.chore_date,
          path: '/(parent)' satisfies NotificationPath,
        },
      },
    ]);
    forgotten += await recordSends(db, id, 'parent_device', [{ device, result: results[0] }], now);
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
