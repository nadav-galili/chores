import { beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import {
  builtinRewardId,
  COINS_PER_CHORE,
  digestCopy,
  kidReminderCopy,
  notificationId,
  parentDeviceId,
  uuid7,
  type DeviceSession,
} from '@chores/shared';
import { createApp } from './app.ts';
import { runTick } from './cron.ts';
import type { Db } from './db/client.ts';
import { childDevices, choreInstances, households, notifications } from './db/schema.ts';
import type { Push, PushMessage, PushReceipt, PushSend } from './push.ts';
import { asParent, fakeVerifyToken } from './test/auth.ts';
import { freshDb } from './test/db.ts';
import { completeOp, setTestPin, syncAs } from './test/household.ts';

let db: Db;
let app: ReturnType<typeof createApp>;

beforeAll(async () => {
  db = await freshDb();
  app = createApp(db, {
    verifyToken: fakeVerifyToken,
    redeemLimit: { max: 1000, windowMs: 60_000 },
  });
});

const TOKEN = 'ExponentPushToken[test-token-1]';

type FakePush = {
  /** What every send answers, or null for a fresh ticket each time. */
  send: PushSend | null;
  /** What every receipt asked for answers, or null for "Expo has nothing yet". */
  receipt: PushReceipt | null;
  sent: PushMessage[];
  asked: string[];
  push: Push;
};

/**
 * A push service whose answers the test writes. Tickets carry the caller's prefix, because every
 * test in this file shares one database and a tick looks at every household in it.
 */
function fakePush(prefix: string): FakePush {
  const fake: FakePush = {
    send: null,
    receipt: null,
    sent: [],
    asked: [],
    push: {
      send(messages) {
        fake.sent.push(...messages);
        return Promise.resolve(
          messages.map(
            (_, i): PushSend =>
              fake.send ?? {
                ok: true,
                ticket: `${prefix}-${fake.sent.length - messages.length + i + 1}`,
              },
          ),
        );
      },
      receipts(ticketIds) {
        fake.asked.push(...ticketIds);
        const receipt = fake.receipt;
        if (!receipt) return Promise.resolve({});
        return Promise.resolve(Object.fromEntries(ticketIds.map((id) => [id, receipt])));
      },
    },
  };
  return fake;
}

/** A household with one child, a daily chore and — unless told otherwise — a joined kid device. */
async function setup(
  clerkUserId: string,
  opts: {
    tz: string;
    reminder?: string;
    boundary?: number;
    device?: boolean;
    /** Every household in this file gets an hour of its own: one tick looks at all of them. */
    digestHour?: number;
    chore?: boolean;
  } = {
    tz: 'Asia/Jerusalem',
  },
) {
  const res = await app.request(
    '/households',
    asParent(clerkUserId, {
      method: 'POST',
      body: JSON.stringify({ name: 'Galili', tz: opts.tz, currency: 'ILS' }),
    }),
  );
  const { household, parent } = (await res.json()) as {
    household: { id: string };
    parent: { id: string };
  };
  await setTestPin(app, clerkUserId, household.id);
  await db
    .update(households)
    .set({
      ...(opts.boundary !== undefined ? { dayBoundaryHour: opts.boundary } : {}),
      // 04:00 local is an hour no tick in this file passes, so a household that is not the
      // digest under test never pushes into another test's recorded sends.
      digestHour: opts.digestHour ?? 4,
    })
    .where(eq(households.id, household.id));
  const created = await app.request(
    `/households/${household.id}/children`,
    asParent(clerkUserId, {
      method: 'POST',
      body: JSON.stringify({
        first_name: 'Noa',
        ui_mode: 'little',
        pet_name: 'Pip',
        reminder_time: opts.reminder ?? null,
      }),
    }),
  );
  const child = (await created.json()) as { id: string };
  const addChore = async (title: string) => {
    const choreId = uuid7();
    await app.request(
      `/households/${household.id}/chores/${choreId}`,
      asParent(clerkUserId, {
        method: 'PUT',
        body: JSON.stringify({
          fields: { title, kind: 'daily', assignees: [child.id] },
          updated_at: new Date().toISOString(),
        }),
      }),
    );
    return choreId;
  };
  const chore = opts.chore === false ? undefined : await addChore('Dishes');

  let session: DeviceSession | undefined;
  if (opts.device !== false) {
    const issued = (await (
      await app.request(
        `/households/${household.id}/children/${child.id}/join-code`,
        asParent(clerkUserId, { method: 'POST' }),
      )
    ).json()) as { code: string };
    const redeemed = await app.request('/join-codes/redeem', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: issued.code, platform: 'android' }),
    });
    session = (await redeemed.json()) as DeviceSession;
  }
  return {
    householdId: household.id,
    parentId: parent.id,
    childId: child.id,
    chore,
    session,
    addChore,
  };
}

/** A parent's own phone registering for push, the way the parent app does on every open. */
const registerParent = (
  householdId: string,
  clerkUserId: string,
  expo_push_token: string,
  locale: 'en' | 'he' = 'en',
) =>
  app.request(
    `/households/${householdId}/devices`,
    asParent(clerkUserId, {
      method: 'POST',
      body: JSON.stringify({ expo_push_token, platform: 'android', locale }),
    }),
  );

/** Registers a push token the way a kid device does: one `/sync` op. */
async function registerToken(session: DeviceSession, token = TOKEN, locale?: 'en' | 'he') {
  const res = await app.request('/sync', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${session.device_token}`,
    },
    body: JSON.stringify({
      device_id: session.device_id,
      cursor: 0,
      ops: [
        {
          op_id: uuid7(),
          type: 'register_push_token',
          payload: { expo_push_token: token, ...(locale ? { locale } : {}) },
        },
      ],
    }),
  });
  expect(res.status).toBe(200);
}

const instancesOn = async (householdId: string, choreDate: string) =>
  db
    .select({ id: choreInstances.id })
    .from(choreInstances)
    .where(
      and(eq(choreInstances.householdId, householdId), eq(choreInstances.choreDate, choreDate)),
    );

const reminderRow = async (childId: string, choreDate: string) => {
  const [row] = await db
    .select()
    .from(notifications)
    .where(eq(notifications.id, notificationId('kid_reminder', childId, choreDate)));
  return row;
};

const digestRow = async (parentId: string, choreDate: string) => {
  const [row] = await db
    .select()
    .from(notifications)
    .where(eq(notifications.id, notificationId('parent_digest', parentId, choreDate)));
  return row;
};

const tokenOf = async (deviceId: string) => {
  const [row] = await db.select().from(childDevices).where(eq(childDevices.id, deviceId));
  return row?.expoPushToken ?? null;
};

describe('day rollover', () => {
  it('materializes the new day once per household per day, at that household’s boundary', async () => {
    // Midnight in Jerusalem on the 10th; New York is still at 17:00 on the 9th.
    const midnightInJerusalem = new Date('2026-09-09T21:00:30Z');
    const jerusalem = await setup('user_roll_jlm', { tz: 'Asia/Jerusalem', device: false });
    const newYork = await setup('user_roll_nyc', { tz: 'America/New_York', device: false });
    const push = fakePush('roll');
    const mine = (result: { rolled: { household_id: string }[] }) =>
      result.rolled.filter((r) =>
        [jerusalem.householdId, newYork.householdId].includes(r.household_id),
      );

    expect(mine(await runTick(db, push.push, midnightInJerusalem))).toEqual([
      { household_id: jerusalem.householdId, chore_date: '2026-09-10' },
    ]);
    expect(await instancesOn(jerusalem.householdId, '2026-09-10')).toHaveLength(1);
    expect(await instancesOn(newYork.householdId, '2026-09-10')).toHaveLength(0);

    // Every further tick inside the catch-up window, and a restart, leave the same one instance.
    for (const minutes of [0, 1, 2]) {
      await runTick(db, push.push, new Date(midnightInJerusalem.getTime() + minutes * 60_000));
    }
    expect(await instancesOn(jerusalem.householdId, '2026-09-10')).toHaveLength(1);

    // Four hours later New York crosses its own midnight.
    const midnightInNewYork = new Date('2026-09-10T04:00:20Z');
    expect(mine(await runTick(db, push.push, midnightInNewYork))).toEqual([
      { household_id: newYork.householdId, chore_date: '2026-09-10' },
    ]);
    expect(await instancesOn(newYork.householdId, '2026-09-10')).toHaveLength(1);
    expect(await instancesOn(jerusalem.householdId, '2026-09-10')).toHaveLength(1);
  });

  it('rolls a household whose boundary hour is not midnight at that hour', async () => {
    const household = await setup('user_roll_boundary', {
      tz: 'Asia/Jerusalem',
      boundary: 3,
      device: false,
    });
    const push = fakePush('boundary');
    const mine = (result: { rolled: { household_id: string }[] }) =>
      result.rolled.filter((r) => r.household_id === household.householdId);

    // 21:00Z is local midnight: too early for a household whose day turns at 03:00.
    expect(mine(await runTick(db, push.push, new Date('2026-09-10T21:00:10Z')))).toEqual([]);
    const atBoundary = new Date('2026-09-11T00:00:10Z'); // 03:00 in Jerusalem on the 11th
    expect(mine(await runTick(db, push.push, atBoundary))).toEqual([
      { household_id: household.householdId, chore_date: '2026-09-11' },
    ]);
    expect(await instancesOn(household.householdId, '2026-09-11')).toHaveLength(1);
  });
});

describe('kid reminder', () => {
  const at = (utc: string) => new Date(utc);

  it('pushes to the child’s device and records the ticket, once', async () => {
    const { childId, session } = await setup('user_remind_push', {
      tz: 'Asia/Jerusalem',
      reminder: '16:00',
    });
    await registerToken(session!);
    const push = fakePush('reminder');

    await runTick(db, push.push, at('2026-09-09T13:00:10Z')); // 16:00 in Jerusalem
    expect(push.sent).toEqual([
      expect.objectContaining({ to: TOKEN, data: { child_id: childId, chore_date: '2026-09-09' } }),
    ]);
    const row = await reminderRow(childId, '2026-09-09');
    expect(row).toMatchObject({
      kind: 'kid_reminder',
      target: 'child_device',
      ticket: 'reminder-1',
    });
    expect(row!.targetId).toBe(session!.device_id);
    expect(row!.sentAt).not.toBeNull();

    // Later ticks in the same window, and a restart, must not nudge the child again.
    await runTick(db, push.push, at('2026-09-09T13:01:10Z'));
    await runTick(db, push.push, at('2026-09-09T13:02:10Z'));
    expect(push.sent).toHaveLength(1);
  });

  it('nudges the child in the language their device registered in', async () => {
    const hebrew = await setup('user_remind_he', { tz: 'Asia/Jerusalem', reminder: '16:10' });
    await registerToken(hebrew.session!, 'ExponentPushToken[he-device]', 'he');
    const english = await setup('user_remind_en', { tz: 'Asia/Jerusalem', reminder: '16:10' });
    await registerToken(english.session!, 'ExponentPushToken[en-device]');
    const push = fakePush('locale');

    await runTick(db, push.push, at('2026-09-09T13:10:10Z')); // 16:10 in Jerusalem
    const copyFor = (token: string) => push.sent.find((m) => m.to === token);
    expect(copyFor('ExponentPushToken[he-device]')).toMatchObject(kidReminderCopy('he'));
    expect(copyFor('ExponentPushToken[en-device]')).toMatchObject(kidReminderCopy('en'));
  });

  it('keeps the language on file when an op carries none', async () => {
    const { session } = await setup('user_remind_keep', {
      tz: 'Asia/Jerusalem',
      reminder: '16:20',
    });
    await registerToken(session!, 'ExponentPushToken[keep-device]', 'he');
    // A token rotates; the op that carries it says nothing about the language.
    await registerToken(session!, 'ExponentPushToken[keep-device-2]');
    const push = fakePush('keep');

    await runTick(db, push.push, at('2026-09-09T13:20:10Z')); // 16:20 in Jerusalem
    expect(push.sent[0]).toMatchObject({
      to: 'ExponentPushToken[keep-device-2]',
      ...kidReminderCopy('he'),
    });
  });

  it('records the reminder with no ticket when the device has no push token', async () => {
    const { childId } = await setup('user_remind_local', {
      tz: 'Asia/Jerusalem',
      reminder: '17:00',
    });
    const push = fakePush('local');

    await runTick(db, push.push, at('2026-09-09T14:00:10Z')); // 17:00 in Jerusalem
    expect(push.sent).toEqual([]);
    const row = await reminderRow(childId, '2026-09-09');
    expect(row).toMatchObject({ kind: 'kid_reminder', ticket: null, sentAt: null, targetId: null });
  });

  it('forgets a token Expo refuses at send', async () => {
    const { childId, session } = await setup('user_remind_gone', {
      tz: 'Asia/Jerusalem',
      reminder: '18:00',
    });
    await registerToken(session!);
    const push = fakePush('gone');
    push.send = { ok: false, error: 'DeviceNotRegistered' };

    await runTick(db, push.push, at('2026-09-09T15:00:10Z'));
    expect(await tokenOf(session!.device_id)).toBeNull();
    const row = await reminderRow(childId, '2026-09-09');
    expect(row).toMatchObject({ ticket: null, sentAt: null });
    expect(row!.payload).toMatchObject({ error: 'DeviceNotRegistered' });
  });

  it('tries again on a transient failure, and only within the window', async () => {
    const { childId, session } = await setup('user_remind_retry', {
      tz: 'Asia/Jerusalem',
      reminder: '20:00',
    });
    await registerToken(session!);
    const push = fakePush('retry');
    push.send = { ok: false, error: 'MessageRateExceeded' };

    await runTick(db, push.push, at('2026-09-09T17:00:10Z')); // 20:00 in Jerusalem
    expect(push.sent).toHaveLength(1);
    expect(await reminderRow(childId, '2026-09-09')).toMatchObject({ sentAt: null, ticket: null });
    // The token is Expo's to keep: only DeviceNotRegistered means the device is gone.
    expect(await tokenOf(session!.device_id)).toBe(TOKEN);

    push.send = null;
    await runTick(db, push.push, at('2026-09-09T17:01:10Z'));
    expect(push.sent).toHaveLength(2);
    const row = await reminderRow(childId, '2026-09-09');
    expect(row!.sentAt).not.toBeNull();

    // Delivered: nothing tries again, however many ticks come past.
    await runTick(db, push.push, at('2026-09-09T17:02:10Z'));
    expect(push.sent).toHaveLength(2);
  });

  it('forgets a token a receipt refuses, once the receipt is worth asking for', async () => {
    const { childId, session } = await setup('user_remind_receipt', {
      tz: 'Asia/Jerusalem',
      reminder: '19:00',
    });
    await registerToken(session!);
    const push = fakePush('receipt');

    await runTick(db, push.push, at('2026-09-09T16:00:10Z')); // 19:00 in Jerusalem
    expect(push.sent).toHaveLength(1);
    const ticket = (await reminderRow(childId, '2026-09-09'))!.ticket!;

    // A ticket is not a delivery: Expo answers for it minutes later.
    await runTick(db, push.push, at('2026-09-09T16:05:10Z'));
    expect(push.asked).not.toContain(ticket);

    push.receipt = { ok: false, error: 'DeviceNotRegistered' };
    await runTick(db, push.push, at('2026-09-09T16:30:10Z'));
    expect(push.asked).toContain(ticket);
    expect(await tokenOf(session!.device_id)).toBeNull();
    expect((await reminderRow(childId, '2026-09-09'))!.payload).toMatchObject({
      receipt: 'DeviceNotRegistered',
    });

    // The receipt has been read; a later tick does not ask again.
    await runTick(db, push.push, at('2026-09-09T17:00:10Z'));
    expect(push.asked.filter((id) => id === ticket)).toEqual([ticket]);
  });
});

describe('evening digest', () => {
  const at = (utc: string) => new Date(utc);
  /** Midnight in Jerusalem on the 9th: the boundary tick that materializes that day. */
  const BOUNDARY_OF_THE_NINTH = '2026-09-08T21:00:20Z';

  it('summarises the chore date that is still open, and sends it once', async () => {
    const fixture = await setup('user_digest_one', { tz: 'Asia/Jerusalem', digestHour: 20 });
    const { householdId, parentId, chore, session } = fixture;
    await fixture.addChore('Laundry');
    const token = 'ExponentPushToken[digest-one]';
    await registerParent(householdId, 'user_digest_one', token);
    const push = fakePush('digest');

    await runTick(db, push.push, at(BOUNDARY_OF_THE_NINTH));
    // One of the two chores gets done on the 9th; the day is still open.
    await syncAs(app, session!, [completeOp(chore!, { chore_date: '2026-09-09' })]);

    const result = await runTick(db, push.push, at('2026-09-09T17:00:20Z')); // 20:00 in Jerusalem
    expect(result.digested).toEqual([{ household_id: householdId, chore_date: '2026-09-09' }]);
    expect(push.sent).toEqual([
      {
        to: token,
        ...digestCopy('en', {
          children: [{ first_name: 'Noa', due_count: 2, done_count: 1 }],
          undecided_redemptions: 0,
        }),
        data: { chore_date: '2026-09-09' },
      },
    ]);
    // What the parent reads counts what is done, and never says the day was not finished.
    expect(push.sent[0]!.body).toContain('1/2 done');
    expect(push.sent[0]!.body.toLowerCase()).not.toContain('did not');

    const row = await digestRow(parentId, '2026-09-09');
    expect(row).toMatchObject({
      kind: 'parent_digest',
      target: 'parent_device',
      ticket: 'digest-1',
    });
    expect(row!.targetId).toBe(parentDeviceId(parentId, token));
    expect(row!.sentAt).not.toBeNull();

    // The catch-up window is five ticks wide, and a restart is a sixth: one digest all the same.
    for (const minute of [1, 2, 3, 4]) {
      const later = await runTick(db, push.push, at(`2026-09-09T17:0${minute}:20Z`));
      expect(later.digested).toEqual([]);
    }
    expect(push.sent).toHaveLength(1);
  });

  it('says who is Day Complete, and each parent in their own language', async () => {
    const parent = 'user_digest_two_at_galili.test';
    const partner = 'user_partner_at_galili.test';
    const fixture = await setup(parent, { tz: 'Asia/Jerusalem', digestHour: 22 });
    const { householdId, parentId, chore, session } = fixture;
    await app.request(
      `/households/${householdId}/parents`,
      asParent(parent, { method: 'POST', body: JSON.stringify({ email: 'partner@galili.test' }) }),
    );
    // The partner becomes a parent on their first sign-in with the address they were invited at.
    const me = await app.request('/me', asParent(partner));
    const { parent: partnerRow } = (await me.json()) as { parent: { id: string } };

    const english = 'ExponentPushToken[digest-en]';
    const hebrew = 'ExponentPushToken[digest-he]';
    await registerParent(householdId, parent, english, 'en');
    await registerParent(householdId, partner, hebrew, 'he');
    const push = fakePush('two');

    await runTick(db, push.push, at(BOUNDARY_OF_THE_NINTH));
    await syncAs(app, session!, [completeOp(chore!, { chore_date: '2026-09-09' })]);

    const result = await runTick(db, push.push, at('2026-09-09T19:00:20Z')); // 22:00 in Jerusalem
    expect(result.digested).toEqual([{ household_id: householdId, chore_date: '2026-09-09' }]);
    const summary = {
      children: [{ first_name: 'Noa', due_count: 1, done_count: 1 }],
      undecided_redemptions: 0,
    };
    const to = (token: string) => push.sent.find((m) => m.to === token);
    expect(push.sent).toHaveLength(2);
    expect(to(english)).toMatchObject(digestCopy('en', summary));
    expect(to(hebrew)).toMatchObject(digestCopy('he', summary));
    expect(to(english)!.body).toContain('1/1 done — all done');

    // Each parent's claim is their own, and repeated ticks tell each of them once.
    expect((await digestRow(parentId, '2026-09-09'))!.ticket).toBe('two-1');
    expect((await digestRow(partnerRow.id, '2026-09-09'))!.ticket).toBe('two-2');
    await runTick(db, push.push, at('2026-09-09T19:01:20Z'));
    await runTick(db, push.push, at('2026-09-09T19:02:20Z'));
    expect(push.sent).toHaveLength(2);
  });

  it('records the digest with no ticket when the parent has registered no phone', async () => {
    const fixture = await setup('user_digest_nophone', {
      tz: 'Asia/Jerusalem',
      digestHour: 23,
      device: false,
    });
    const push = fakePush('nophone');

    await runTick(db, push.push, at(BOUNDARY_OF_THE_NINTH));
    const result = await runTick(db, push.push, at('2026-09-09T20:00:20Z')); // 23:00 in Jerusalem
    expect(result.digested).toEqual([
      { household_id: fixture.householdId, chore_date: '2026-09-09' },
    ]);
    expect(push.sent).toEqual([]);
    expect(await digestRow(fixture.parentId, '2026-09-09')).toMatchObject({
      kind: 'parent_digest',
      ticket: null,
      sentAt: null,
      targetId: null,
    });
  });

  it('sends nothing at all when nothing was due and nothing is waiting', async () => {
    const fixture = await setup('user_digest_quiet', {
      tz: 'Asia/Jerusalem',
      digestHour: 21,
      chore: false,
      device: false,
    });
    await registerParent(fixture.householdId, 'user_digest_quiet', 'ExponentPushToken[quiet]');
    const push = fakePush('quiet');

    // The boundary rolls the 9th; this household has no chore, so it materializes nothing.
    await runTick(db, push.push, at(BOUNDARY_OF_THE_NINTH));
    const result = await runTick(db, push.push, at('2026-09-09T18:00:20Z')); // 21:00 in Jerusalem
    expect(result.digested).toEqual([]);
    expect(push.sent).toEqual([]);
    // No claim row either: a chore that becomes due at 21:30 must still be able to send.
    expect(await digestRow(fixture.parentId, '2026-09-09')).toBeUndefined();
  });

  it('counts the undecided redemptions on a day with nothing else to say', async () => {
    const fixture = await setup('user_digest_waiting', {
      tz: 'Asia/Jerusalem',
      digestHour: 19,
      chore: false,
    });
    const { householdId, parentId, session } = fixture;
    const token = 'ExponentPushToken[digest-waiting]';
    await registerParent(householdId, 'user_digest_waiting', token);

    // Coins today, and a reward asked for with them: nothing is due on the 9th all the same.
    const earning = [];
    for (let i = 0; i < Math.ceil(50 / COINS_PER_CHORE); i++) {
      earning.push(completeOp(await fixture.addChore(`Chore ${i}`)));
    }
    await syncAs(app, session!, earning);
    const redemptionId = uuid7();
    await syncAs(app, session!, [
      {
        op_id: uuid7(),
        type: 'request_redemption',
        payload: {
          redemption_id: redemptionId,
          reward_id: builtinRewardId(householdId, 'snack'),
          requested_at: new Date().toISOString(),
        },
      },
    ]);
    const push = fakePush('waiting');

    const result = await runTick(db, push.push, at('2026-09-09T16:00:20Z')); // 19:00 in Jerusalem
    expect(result.digested).toEqual([{ household_id: householdId, chore_date: '2026-09-09' }]);
    // The same tick also interrupts the parent about the request itself (#51). Two notifications,
    // because they answer two different things: one is the child waiting, the other the evening.
    expect(result.announced).toEqual([
      { kind: 'redemption_requested', redemption_id: redemptionId, subject_id: parentId },
    ]);
    const digests = push.sent.filter((m) => !('kind' in (m.data ?? {})));
    expect(digests).toEqual([
      {
        to: token,
        ...digestCopy('en', {
          children: [{ first_name: 'Noa', due_count: 0, done_count: 0 }],
          undecided_redemptions: 1,
        }),
        data: { chore_date: '2026-09-09' },
      },
    ]);
    expect(digests[0]!.body).toContain('1 reward is waiting for you');
    expect(digests[0]!.body).toContain('Noa — nothing due');
    expect((await digestRow(parentId, '2026-09-09'))!.payload).toMatchObject({
      parent_id: parentId,
      chore_date: '2026-09-09',
    });
  });
});
