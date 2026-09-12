import {
  builtinRewardId,
  COINS_PER_CHORE,
  notificationId,
  openedNotificationDestination,
  parentDeviceId,
  redemptionRequestedCopy,
  rewardApprovedCopy,
  uuid7,
  type DeviceSession,
} from '@chores/shared';
import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { createApp } from './app.ts';
import { runTick } from './cron.ts';
import type { Db } from './db/client.ts';
import { childDevices, notifications, parentDevices, redemptions } from './db/schema.ts';
import { IMMEDIATE_CATCHUP_MS, RECEIPT_DELAY_MS } from './notifications.ts';
import type { Push, PushError, PushMessage, PushReceipt, PushSend } from './push.ts';
import { asParent, fakeVerifyToken } from './test/auth.ts';
import { freshDb } from './test/db.ts';
import { completeOp, setupHousehold, syncAs } from './test/household.ts';

/**
 * The two immediate notifications (docs/spec/01-product.md, notifications): a child asks for a
 * reward and every parent device is told, a parent approves and the child's device is told. Both
 * are claimed by their deterministic id, so the tick that repeats — five of them fit in the
 * catch-up window — sends once.
 */

let db: Db;
let app: ReturnType<typeof createApp>;

beforeAll(async () => {
  db = await freshDb();
  app = createApp(db, {
    verifyToken: fakeVerifyToken,
    redeemLimit: { max: 1000, windowMs: 60_000 },
  });
});

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

/** The fake Clerk user carries its email, so an invited partner can sign in as a second parent. */
const as = (local: string) => `user_${local}_at_example.com`;

/** A household whose Noa has coins to spend, plus a `snack` to spend them on. */
async function spender(local: string) {
  const owner = as(local);
  const fixture = await setupHousehold(app, owner);
  const ops = [];
  for (let i = 0; i < 60 / COINS_PER_CHORE; i++) {
    ops.push(completeOp(await fixture.addChore(`Chore ${i}`, [fixture.noa.id])));
  }
  await syncAs(app, fixture.noa.session, ops);
  return { ...fixture, owner, snack: builtinRewardId(fixture.householdId, 'snack') };
}

/** The child asks, over `/sync`, the way the shop does. */
async function ask(session: DeviceSession, rewardId: string) {
  const redemptionId = uuid7();
  const { body } = await syncAs(app, session, [
    {
      op_id: uuid7(),
      type: 'request_redemption',
      payload: {
        redemption_id: redemptionId,
        reward_id: rewardId,
        requested_at: new Date().toISOString(),
      },
    },
  ]);
  expect(body.rejected).toEqual([]);
  return redemptionId;
}

const decide = (householdId: string, clerkUserId: string, redemptionId: string, decision: string) =>
  app.request(
    `/households/${householdId}/redemptions/${redemptionId}/decide`,
    asParent(clerkUserId, { method: 'POST', body: JSON.stringify({ decision }) }),
  );

/** This parent's phone registering for push, the way the app does on every open. */
async function registerParent(
  householdId: string,
  clerkUserId: string,
  expo_push_token: string,
  locale: 'en' | 'he' = 'en',
) {
  const res = await app.request(
    `/households/${householdId}/devices`,
    asParent(clerkUserId, {
      method: 'POST',
      body: JSON.stringify({ expo_push_token, platform: 'android', locale }),
    }),
  );
  expect(res.status).toBe(201);
  return ((await res.json()) as { id: string }).id;
}

/** A kid device registering its token, the way it does: one `/sync` op. */
async function registerKid(session: DeviceSession, token: string, locale?: 'en' | 'he') {
  const { status } = await syncAs(app, session, [
    {
      op_id: uuid7(),
      type: 'register_push_token',
      payload: { expo_push_token: token, ...(locale ? { locale } : {}) },
    },
  ]);
  expect(status).toBe(200);
}

const parentIdOf = async (clerkUserId: string) => {
  const me = (await (await app.request('/me', asParent(clerkUserId))).json()) as {
    parent: { id: string };
  };
  return me.parent.id;
};

const rowOf = async (
  kind: 'redemption_requested' | 'reward_approved',
  subject: string,
  key: string,
) => {
  const [row] = await db
    .select()
    .from(notifications)
    .where(eq(notifications.id, notificationId(kind, subject, key)));
  return row;
};

const parentTokenOf = async (deviceId: string) => {
  const [row] = await db.select().from(parentDevices).where(eq(parentDevices.id, deviceId));
  return row?.expoPushToken ?? null;
};

const decidedAtOf = async (redemptionId: string) => {
  const [row] = await db
    .select({ decidedAt: redemptions.decidedAt })
    .from(redemptions)
    .where(eq(redemptions.id, redemptionId));
  return row!.decidedAt!;
};

const kidTokenOf = async (deviceId: string) => {
  const [row] = await db.select().from(childDevices).where(eq(childDevices.id, deviceId));
  return row?.expoPushToken ?? null;
};

describe('redemption_requested', () => {
  it('tells every parent device with a token, once however many ticks come past', async () => {
    const h = await spender('req_two');
    // A second parent, each on their own phone and in their own language.
    await app.request(
      `/households/${h.householdId}/parents`,
      asParent(h.owner, { method: 'POST', body: JSON.stringify({ email: 'dana@example.com' }) }),
    );
    await app.request('/me', asParent(as('dana')));
    const ownerId = await parentIdOf(h.owner);
    const danaId = await parentIdOf(as('dana'));
    const ownerPhone = 'ExponentPushToken[req-two-owner]';
    const ownerTablet = 'ExponentPushToken[req-two-owner-2]';
    const danaPhone = 'ExponentPushToken[req-two-dana]';
    await registerParent(h.householdId, h.owner, ownerPhone, 'en');
    await registerParent(h.householdId, h.owner, ownerTablet, 'en');
    await registerParent(h.householdId, as('dana'), danaPhone, 'he');

    const redemptionId = await ask(h.noa.session, h.snack);
    const push = fakePush('req-two');
    const now = new Date();
    for (const minute of [0, 1, 2]) {
      await runTick(db, push.push, new Date(now.getTime() + minute * 60_000));
    }

    // Three devices, three pushes, and not one more for the two later ticks.
    const mine = push.sent.filter((m) => m.to.includes('req-two'));
    expect(mine.map((m) => m.to).sort()).toEqual([ownerPhone, ownerTablet, danaPhone].sort());
    expect(mine.find((m) => m.to === danaPhone)).toMatchObject(redemptionRequestedCopy('he'));
    expect(mine.find((m) => m.to === ownerPhone)).toMatchObject(redemptionRequestedCopy('en'));

    // One claim row per parent, both sent, each naming a device of that parent's.
    const owner = await rowOf('redemption_requested', redemptionId, ownerId);
    const dana = await rowOf('redemption_requested', redemptionId, danaId);
    expect(owner?.target).toBe('parent_device');
    expect(owner?.sentAt).not.toBeNull();
    expect([parentDeviceId(ownerId, ownerPhone), parentDeviceId(ownerId, ownerTablet)]).toContain(
      owner?.targetId,
    );
    expect(dana?.sentAt).not.toBeNull();
    expect(dana?.targetId).toBe(parentDeviceId(danaId, danaPhone));
  });

  it('deep-links to the redemption, and carries no state', async () => {
    const h = await spender('req_link');
    await registerParent(h.householdId, h.owner, 'ExponentPushToken[req-link]');
    const redemptionId = await ask(h.noa.session, h.snack);

    const push = fakePush('req-link');
    await runTick(db, push.push, new Date());

    const [message] = push.sent.filter((m) => m.to.includes('req-link'));
    // The kind is the one thing a device may read off an opened push and report (ADR-0009); the
    // ids and the path are the deep link, and none of it is state the device writes down.
    expect(message?.data).toEqual({
      kind: 'redemption_requested',
      household_id: h.householdId,
      redemption_id: redemptionId,
      path: '/(parent)',
    });
    // And the device reads that back as the parent's day with this request named, which is what
    // makes the tap land on the request rather than on the screen in general.
    expect(openedNotificationDestination(message?.data)).toEqual({
      path: '/(parent)',
      audience: 'parent',
      params: { redemption: redemptionId },
    });
  });

  it('is not an error for a parent with no device: the row stands, unsent', async () => {
    const h = await spender('req_none');
    const parentId = await parentIdOf(h.owner);
    const redemptionId = await ask(h.noa.session, h.snack);

    const push = fakePush('req-none');
    const result = await runTick(db, push.push, new Date());

    const row = await rowOf('redemption_requested', redemptionId, parentId);
    expect(row?.sentAt).toBeNull();
    expect(row?.targetId).toBeNull();
    expect(push.sent.filter((m) => m.to.includes('req-none'))).toHaveLength(0);
    // Claimed all the same, so a later tick does not try again.
    expect(result.announced).toContainEqual({
      kind: 'redemption_requested',
      redemption_id: redemptionId,
      subject_id: parentId,
    });
  });

  it('stops once the redemption is decided', async () => {
    const h = await spender('req_done');
    const redemptionId = await ask(h.noa.session, h.snack);
    expect((await decide(h.householdId, h.owner, redemptionId, 'decline')).status).toBe(200);

    const push = fakePush('req-done');
    await runTick(db, push.push, new Date());
    const row = await rowOf('redemption_requested', redemptionId, await parentIdOf(h.owner));
    expect(row).toBeUndefined();
  });
});

describe('reward_approved', () => {
  it('tells the child’s newest live device with a token, once however many ticks come past', async () => {
    const h = await spender('app_one');
    const token = 'ExponentPushToken[app-one-kid]';
    await registerKid(h.noa.session, token, 'he');
    const redemptionId = await ask(h.noa.session, h.snack);
    expect((await decide(h.householdId, h.owner, redemptionId, 'approve')).status).toBe(200);

    const push = fakePush('app-one');
    const now = new Date();
    for (const minute of [0, 1, 2]) {
      await runTick(db, push.push, new Date(now.getTime() + minute * 60_000));
    }

    const mine = push.sent.filter((m) => m.to === token);
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject(rewardApprovedCopy('he'));
    expect(mine[0]?.data).toEqual({
      kind: 'reward_approved',
      child_id: h.noa.id,
      redemption_id: redemptionId,
      path: '/(kid)/shop',
    });
    expect(openedNotificationDestination(mine[0]?.data)).toEqual({
      path: '/(kid)/shop',
      audience: 'kid',
      params: { redemption: redemptionId },
    });

    const row = await rowOf('reward_approved', redemptionId, h.noa.id);
    expect(row?.target).toBe('child_device');
    expect(row?.targetId).toBe(h.noa.session.device_id);
    expect(row?.sentAt).not.toBeNull();
    // A payload carries what the row is about and never what the balance is (ADR-0014).
    expect(row?.payload).toEqual({ redemption_id: redemptionId, child_id: h.noa.id });
  });

  it('says nothing for a decline, and nothing for a child with no token', async () => {
    const h = await spender('app_no');
    const declined = await ask(h.noa.session, h.snack);
    expect((await decide(h.householdId, h.owner, declined, 'decline')).status).toBe(200);
    const approved = await ask(h.noa.session, h.snack);
    expect((await decide(h.householdId, h.owner, approved, 'approve')).status).toBe(200);

    const push = fakePush('app-no');
    await runTick(db, push.push, new Date());

    expect(await rowOf('reward_approved', declined, h.noa.id)).toBeUndefined();
    const row = await rowOf('reward_approved', approved, h.noa.id);
    expect(row?.sentAt).toBeNull();
    expect(row?.targetId).toBeNull();
    expect(push.sent.filter((m) => m.to.includes('app-no'))).toHaveLength(0);
  });

  /**
   * `IMMEDIATE_CATCHUP_MS` is what stops a restart from telling a child about months of old
   * approvals: an approved redemption stays approved forever, so the scan is bounded rather than
   * the status being the whole condition. One approval, two ticks on either side of the bound —
   * everything but the clock held equal, because the clock is the whole claim.
   */
  it('tells the child at the edge of the catch-up window, and not past it', async () => {
    const h = await spender('app_edge');
    const token = 'ExponentPushToken[app-edge-kid]';
    await registerKid(h.noa.session, token);
    const redemptionId = await ask(h.noa.session, h.snack);
    expect((await decide(h.householdId, h.owner, redemptionId, 'approve')).status).toBe(200);
    const decidedAt = await decidedAtOf(redemptionId);

    const push = fakePush('app-edge');
    // A minute past the window: old news. No claim row is the assertion — a send that was merely
    // skipped would leave the row behind and go out on the next tick.
    await runTick(db, push.push, new Date(decidedAt.getTime() + IMMEDIATE_CATCHUP_MS + 60_000));
    expect(push.sent.filter((m) => m.to === token)).toHaveLength(0);
    expect(await rowOf('reward_approved', redemptionId, h.noa.id)).toBeUndefined();

    // The far edge itself is inside it: the bound is inclusive, so an approval exactly the window
    // old is still told to the child.
    await runTick(db, push.push, new Date(decidedAt.getTime() + IMMEDIATE_CATCHUP_MS));
    expect(push.sent.filter((m) => m.to === token)).toHaveLength(1);
    expect((await rowOf('reward_approved', redemptionId, h.noa.id))?.sentAt).not.toBeNull();
  });
});

describe('receipts for the immediate kinds', () => {
  it('forgets a parent token a receipt refuses, and does not ask twice', async () => {
    const h = await spender('rec_parent');
    const token = 'ExponentPushToken[rec-parent]';
    const deviceId = await registerParent(h.householdId, h.owner, token);
    await ask(h.noa.session, h.snack);

    const push = fakePush('rec-parent');
    const sentAt = new Date();
    await runTick(db, push.push, sentAt);
    expect(push.sent.filter((m) => m.to === token)).toHaveLength(1);

    // A ticket is not a delivery, and Expo has nothing to say about it for a quarter of an hour.
    await runTick(db, push.push, new Date(sentAt.getTime() + 60_000));
    expect(push.asked.filter((t) => t.startsWith('rec-parent'))).toHaveLength(0);

    push.receipt = { ok: false, error: 'DeviceNotRegistered' };
    const later = new Date(sentAt.getTime() + RECEIPT_DELAY_MS + 60_000);
    await runTick(db, push.push, later);
    expect(push.asked.filter((t) => t.startsWith('rec-parent'))).toHaveLength(1);
    expect(await parentTokenOf(deviceId)).toBeNull();

    await runTick(db, push.push, new Date(later.getTime() + 60_000));
    expect(push.asked.filter((t) => t.startsWith('rec-parent'))).toHaveLength(1);
  });

  it('forgets a kid token the send itself refuses, in the child table', async () => {
    const h = await spender('rec_kid');
    const token = 'ExponentPushToken[rec-kid]';
    await registerKid(h.noa.session, token);
    const redemptionId = await ask(h.noa.session, h.snack);
    expect((await decide(h.householdId, h.owner, redemptionId, 'approve')).status).toBe(200);

    const push = fakePush('rec-kid');
    push.send = { ok: false, error: 'DeviceNotRegistered' satisfies PushError };
    await runTick(db, push.push, new Date());

    expect(await kidTokenOf(h.noa.session.device_id)).toBeNull();
    const row = await rowOf('reward_approved', redemptionId, h.noa.id);
    expect(row?.sentAt).toBeNull();
    // Terminal: a dead token is not worth a second attempt, so the claim stands as it is.
    expect(row?.payload['error']).toBe('DeviceNotRegistered');
  });
});
