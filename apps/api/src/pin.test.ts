import { hashPin, verifyPin, type DeviceSession, type Household } from '@chores/shared';
import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { createApp } from './app.ts';
import type { Db } from './db/client.ts';
import { households } from './db/schema.ts';
import { asParent, fakeVerifyToken } from './test/auth.ts';
import { freshDb } from './test/db.ts';

let db: Db;
let app: ReturnType<typeof createApp>;

beforeAll(async () => {
  db = await freshDb();
  app = createApp(db, {
    verifyToken: fakeVerifyToken,
    redeemLimit: { max: 1000, windowMs: 60_000 },
  });
});

async function household(clerkUserId: string) {
  const res = await app.request(
    '/households',
    asParent(clerkUserId, {
      method: 'POST',
      body: JSON.stringify({ name: 'Galili', tz: 'Asia/Jerusalem', currency: 'ILS' }),
    }),
  );
  const { household } = (await res.json()) as { household: { id: string } };
  const child = await app.request(
    `/households/${household.id}/children`,
    asParent(clerkUserId, {
      method: 'POST',
      body: JSON.stringify({ first_name: 'Noa', ui_mode: 'little', pet_name: 'Pip' }),
    }),
  );
  return { householdId: household.id, childId: ((await child.json()) as { id: string }).id };
}

const setPin = (clerkUserId: string, householdId: string, pin: string) =>
  app.request(
    `/households/${householdId}/pin`,
    asParent(clerkUserId, { method: 'PUT', body: JSON.stringify({ pin }) }),
  );

const row = (householdId: string) =>
  db.query.households.findFirst({ where: eq(households.id, householdId) });

/** The keys of a serialised object that could be carrying something about the Parent PIN. */
const pinKeys = (value: object) =>
  Object.keys(value)
    .filter((key) => key.includes('pin'))
    .sort();

describe('setting the Parent PIN', () => {
  it('stores SHA-256(salt ‖ pin) with a per-household salt, never the pin', async () => {
    const { householdId } = await household('user_pin_set');
    const res = await setPin('user_pin_set', householdId, '4271');
    expect(res.status).toBe(200);
    // The answer is the household the write left behind, carrying neither the pin nor its hash.
    // No key of it could be carrying one either. Scanning the whole serialised answer for the
    // digits would also be scanning the household id — a fresh uuid whose hex is allowed to
    // contain them — so the id is checked by equality and the rest is scanned.
    const answered = (await res.json()) as Household;
    expect(pinKeys(answered)).toEqual([]);
    const { id, ...rest } = answered;
    expect(id).toBe(householdId);
    expect(rest).toMatchObject({ name: 'Galili' });
    expect(JSON.stringify(rest)).not.toContain('4271');

    const saved = await row(householdId);
    expect(saved!.pinSalt).toMatch(/^[0-9a-f]{32}$/);
    expect(saved!.pinHash).toBe(hashPin(saved!.pinSalt!, '4271'));
  });

  it('replaces the pin with no old-pin challenge, and salts the replacement afresh', async () => {
    const { householdId } = await household('user_pin_replace');
    await setPin('user_pin_replace', householdId, '1111');
    const first = await row(householdId);

    expect((await setPin('user_pin_replace', householdId, '2222')).status).toBe(200);
    const second = await row(householdId);
    expect(second!.pinSalt).not.toBe(first!.pinSalt);
    expect(second!.pinHash).toBe(hashPin(second!.pinSalt!, '2222'));
  });

  it('refuses anything that is not four digits', async () => {
    const { householdId } = await household('user_pin_bad');
    for (const pin of ['123', '12345', '12a4']) {
      expect((await setPin('user_pin_bad', householdId, pin)).status).toBe(400);
    }
    expect((await row(householdId))!.pinHash).toBeNull();
  });

  it('is another household’s business only', async () => {
    const { householdId } = await household('user_pin_mine');
    await household('user_pin_theirs');
    expect((await setPin('user_pin_theirs', householdId, '1234')).status).toBe(404);
  });
});

describe('a join code needs a PIN first', () => {
  it('is refused while the household has none, and issued once one is set', async () => {
    const { householdId, childId } = await household('user_pin_gate');
    const issue = () =>
      app.request(
        `/households/${householdId}/children/${childId}/join-code`,
        asParent('user_pin_gate', { method: 'POST' }),
      );

    const before = await issue();
    expect(before.status).toBe(409);
    expect(await before.json()).toEqual({ error: 'pin_required' });

    await setPin('user_pin_gate', householdId, '1234');
    expect((await issue()).status).toBe(201);
  });
});

describe('the pin reaches the kid device', () => {
  const redeem = async (householdId: string, childId: string, clerkUserId: string) => {
    const issued = (await (
      await app.request(
        `/households/${householdId}/children/${childId}/join-code`,
        asParent(clerkUserId, { method: 'POST' }),
      )
    ).json()) as { code: string };
    const res = await app.request('/join-codes/redeem', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: issued.code, platform: 'android' }),
    });
    return (await res.json()) as DeviceSession;
  };

  const me = async (session: DeviceSession) => {
    const res = await app.request('/device/me', {
      headers: { authorization: `Bearer ${session.device_token}` },
    });
    return (await res.json()) as {
      household: {
        entitlement: 'free' | 'premium';
        pin_hash?: string | null;
        pin_salt?: string | null;
      };
    };
  };

  it('rides the session and /device/me as a hash and a salt, never as the pin', async () => {
    const { householdId, childId } = await household('user_pin_device');
    await setPin('user_pin_device', householdId, '4271');
    const session = await redeem(householdId, childId, 'user_pin_device');

    expect(verifyPin(session.household.pin_hash, session.household.pin_salt, '4271')).toBe(true);
    expect(verifyPin(session.household.pin_hash, session.household.pin_salt, '1234')).toBe(false);
    // The pin itself may not ride the session. Scanning the serialised session for the digits
    // would also be scanning a fresh 32-character salt that is allowed to contain them, so what
    // is asserted is the shape: the household carries the hash and the salt, and no other key
    // that could hold a pin.
    expect(pinKeys(session.household)).toEqual(['pin_hash', 'pin_salt']);

    const refreshed = await me(session);
    expect(refreshed.household.pin_hash).toBe(session.household.pin_hash);
    expect(refreshed.household.pin_salt).toBe(session.household.pin_salt);
  });

  it('changes on the parent side reach the device on its next refresh', async () => {
    const { householdId, childId } = await household('user_pin_changed');
    await setPin('user_pin_changed', householdId, '1111');
    const session = await redeem(householdId, childId, 'user_pin_changed');

    await setPin('user_pin_changed', householdId, '2222');
    // The device still holds the old one until it asks — offline, that is the pin that opens.
    expect(verifyPin(session.household.pin_hash, session.household.pin_salt, '1111')).toBe(true);

    const { household: fresh } = await me(session);
    expect(verifyPin(fresh.pin_hash, fresh.pin_salt, '2222')).toBe(true);
    expect(verifyPin(fresh.pin_hash, fresh.pin_salt, '1111')).toBe(false);
  });

  it('mirrors the household entitlement in the session and on every refresh', async () => {
    const { householdId, childId } = await household('user_entitlement_device');
    await setPin('user_entitlement_device', householdId, '4271');
    const session = await redeem(householdId, childId, 'user_entitlement_device');
    expect(session.household.entitlement).toBe('free');

    await db
      .update(households)
      .set({ entitlement: 'premium' })
      .where(eq(households.id, householdId));
    expect((await me(session)).household.entitlement).toBe('premium');
  });
});
