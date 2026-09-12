import { hashPin } from '@chores/shared';
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

describe('setting the Parent PIN', () => {
  it('stores SHA-256(salt ‖ pin) with a per-household salt, never the pin', async () => {
    const { householdId } = await household('user_pin_set');
    const res = await setPin('user_pin_set', householdId, '4271');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ pin_set: true });

    const saved = await row(householdId);
    expect(saved!.pinSalt).toMatch(/^[0-9a-f]{32}$/);
    expect(saved!.pinHash).toBe(hashPin(saved!.pinSalt!, '4271'));
    expect(saved!.pinHash).not.toContain('4271');
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
