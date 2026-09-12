import { beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { parentDeviceId, uuid7, type ParentDevice } from '@chores/shared';
import { createApp } from './app.ts';
import type { Db } from './db/client.ts';
import { notifications, parentDevices } from './db/schema.ts';
import { readReceipts, RECEIPT_DELAY_MS } from './notifications.ts';
import type { Push, PushError, PushMessage, PushSend } from './push.ts';
import { asParent, fakeVerifyToken } from './test/auth.ts';
import { freshDb } from './test/db.ts';

let db: Db;
let app: ReturnType<typeof createApp>;

beforeAll(async () => {
  db = await freshDb();
  app = createApp(db, { verifyToken: fakeVerifyToken });
});

const TOKEN = 'ExponentPushToken[parent-phone]';

/** A household with one parent, which is all a parent device needs. */
async function setup(clerkUserId: string) {
  const res = await app.request(
    '/households',
    asParent(clerkUserId, {
      method: 'POST',
      body: JSON.stringify({ name: 'Galili', tz: 'Asia/Jerusalem', currency: 'ILS' }),
    }),
  );
  const { household, parent } = (await res.json()) as {
    household: { id: string };
    parent: { id: string };
  };
  return { householdId: household.id, parentId: parent.id };
}

const register = (householdId: string, clerkUserId: string, body: unknown) =>
  app.request(
    `/households/${householdId}/devices`,
    asParent(clerkUserId, { method: 'POST', body: JSON.stringify(body) }),
  );

const devicesOf = (parentId: string) =>
  db.select().from(parentDevices).where(eq(parentDevices.parentId, parentId));

describe('POST /households/:householdId/devices', () => {
  it('registers a parent device with its token, platform and language', async () => {
    const { householdId, parentId } = await setup('user_pd_register');
    const res = await register(householdId, 'user_pd_register', {
      expo_push_token: TOKEN,
      platform: 'ios',
      locale: 'he',
    });

    expect(res.status).toBe(201);
    const body = (await res.json()) as ParentDevice;
    expect(body).toMatchObject({ id: parentDeviceId(parentId, TOKEN), parent_id: parentId });
    // The token is a credential the parent's phone already holds; it is not echoed back.
    expect(body).not.toHaveProperty('expo_push_token');
    expect(await devicesOf(parentId)).toMatchObject([
      { expoPushToken: TOKEN, platform: 'ios', locale: 'he' },
    ]);
  });

  it('updates rather than duplicating when the app opens again', async () => {
    const { householdId, parentId } = await setup('user_pd_reopen');
    const body = { expo_push_token: TOKEN, platform: 'android', locale: 'en' };
    const before = (await (
      await register(householdId, 'user_pd_reopen', body)
    ).json()) as ParentDevice;

    // The phone reopens, now reading Hebrew.
    const after = (await (
      await register(householdId, 'user_pd_reopen', { ...body, locale: 'he' })
    ).json()) as ParentDevice;

    expect(after.id).toBe(before.id);
    expect(await devicesOf(parentId)).toMatchObject([{ locale: 'he', expoPushToken: TOKEN }]);
    expect(new Date(after.last_seen_at).getTime()).toBeGreaterThanOrEqual(
      new Date(before.last_seen_at).getTime(),
    );
  });

  it('scopes a token to its parent, and a household to its own', async () => {
    const mine = await setup('user_pd_mine');
    const theirs = await setup('user_pd_theirs');
    const body = { expo_push_token: TOKEN, platform: 'ios', locale: 'en' };
    await register(mine.householdId, 'user_pd_mine', body);
    // The same token registered by another parent is that parent's device, not a claim on mine.
    await register(theirs.householdId, 'user_pd_theirs', body);

    expect(await devicesOf(mine.parentId)).toHaveLength(1);
    expect(await devicesOf(theirs.parentId)).toHaveLength(1);

    // Another household's id is not a route this parent has.
    expect((await register(theirs.householdId, 'user_pd_mine', body)).status).toBe(404);
    expect(await devicesOf(theirs.parentId)).toHaveLength(1);
  });

  it('refuses a body that is not an Expo token', async () => {
    const { householdId, parentId } = await setup('user_pd_bad');
    const res = await register(householdId, 'user_pd_bad', {
      expo_push_token: 'not-a-token',
      platform: 'ios',
      locale: 'en',
    });
    expect(res.status).toBe(400);
    expect(await devicesOf(parentId)).toHaveLength(0);
  });

  it('is not a route for a caller with no session', async () => {
    const { householdId } = await setup('user_pd_anon');
    const res = await app.request(`/households/${householdId}/devices`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ expo_push_token: TOKEN, platform: 'ios', locale: 'en' }),
    });
    expect(res.status).toBe(401);
  });
});

/** A push service that answers every receipt the same way, and is never asked to send. */
function fakePush(error: PushError | null): Push {
  return {
    send: (messages: PushMessage[]) =>
      Promise.resolve(messages.map((): PushSend => ({ ok: true, ticket: 'unused' }))),
    receipts: (ticketIds) =>
      Promise.resolve(
        Object.fromEntries(
          ticketIds.map((id) => [
            id,
            error ? { ok: false as const, error } : { ok: true as const },
          ]),
        ),
      ),
  };
}

describe('receipts against a parent device', () => {
  const sentAt = new Date('2026-09-09T12:00:00Z');
  const later = new Date(sentAt.getTime() + RECEIPT_DELAY_MS + 60_000);

  /** A parent notification already sent, waiting for the receipt Expo owes it. */
  async function sentDigest(clerkUserId: string, ticket: string) {
    const { householdId, parentId } = await setup(clerkUserId);
    await register(householdId, clerkUserId, {
      expo_push_token: TOKEN,
      platform: 'ios',
      locale: 'en',
    });
    await db.insert(notifications).values({
      id: uuid7(),
      target: 'parent_device',
      targetId: parentDeviceId(parentId, TOKEN),
      kind: 'parent_digest',
      scheduledFor: sentAt,
      sentAt,
      ticket,
    });
    return { deviceId: parentDeviceId(parentId, TOKEN) };
  }

  const tokenOf = async (deviceId: string) => {
    const [row] = await db.select().from(parentDevices).where(eq(parentDevices.id, deviceId));
    return row?.expoPushToken ?? null;
  };

  it('forgets the parent token a receipt refuses, in the parent table', async () => {
    const { deviceId } = await sentDigest('user_pd_gone', 'parent-ticket-gone');

    expect(await readReceipts(db, fakePush('DeviceNotRegistered'), later)).toBe(1);
    expect(await tokenOf(deviceId)).toBeNull();
  });

  it('leaves a token a receipt is happy with alone', async () => {
    const { deviceId } = await sentDigest('user_pd_kept', 'parent-ticket-kept');

    expect(await readReceipts(db, fakePush(null), later)).toBe(0);
    expect(await tokenOf(deviceId)).toBe(TOKEN);
  });
});
