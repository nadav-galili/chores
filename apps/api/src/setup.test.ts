import { nextSetupStep, uuid7, type MeSetup } from '@chores/shared';
import { beforeAll, describe, expect, it } from 'vitest';
import { createApp } from './app.ts';
import { asParent, fakeVerifyToken } from './test/auth.ts';
import { freshDb } from './test/db.ts';
import { setTestPin } from './test/household.ts';

let app: ReturnType<typeof createApp>;

beforeAll(async () => {
  app = createApp(await freshDb(), {
    verifyToken: fakeVerifyToken,
    redeemLimit: { max: 1000, windowMs: 60_000 },
  });
});

const setupOf = async (clerkUserId: string) => {
  const res = await app.request('/me', asParent(clerkUserId));
  expect(res.status).toBe(200);
  return ((await res.json()) as { setup: MeSetup }).setup;
};

/** Walks a household forward one setup step at a time, as its creator. */
async function household(clerkUserId: string) {
  const res = await app.request(
    '/households',
    asParent(clerkUserId, {
      method: 'POST',
      body: JSON.stringify({ name: 'Galili', tz: 'Asia/Jerusalem', currency: 'ILS' }),
    }),
  );
  const householdId = ((await res.json()) as { household: { id: string } }).household.id;
  const base = `/households/${householdId}`;
  const addChild = async () => {
    const created = await app.request(
      `${base}/children`,
      asParent(clerkUserId, {
        method: 'POST',
        body: JSON.stringify({ first_name: 'Noa', ui_mode: 'little', pet_name: 'Pip' }),
      }),
    );
    return ((await created.json()) as { id: string }).id;
  };
  const addChore = async (childId: string) => {
    const choreId = uuid7();
    const put = await app.request(
      `${base}/chores/${choreId}`,
      asParent(clerkUserId, {
        method: 'PUT',
        body: JSON.stringify({
          fields: { title: 'Make your bed', kind: 'daily', assignees: [childId] },
          updated_at: new Date().toISOString(),
        }),
      }),
    );
    expect(put.status).toBeLessThan(300);
    return choreId;
  };
  const deleteChore = async (choreId: string) => {
    const del = await app.request(
      `${base}/chores/${choreId}`,
      asParent(clerkUserId, {
        method: 'DELETE',
        body: JSON.stringify({ updated_at: new Date().toISOString() }),
      }),
    );
    expect(del.status).toBeLessThan(300);
  };
  const joinDevice = async (childId: string) => {
    const issued = await app.request(
      `${base}/children/${childId}/join-code`,
      asParent(clerkUserId, { method: 'POST' }),
    );
    const { code } = (await issued.json()) as { code: string };
    const redeemed = await app.request('/join-codes/redeem', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code, platform: 'android' }),
    });
    return ((await redeemed.json()) as { device_id: string }).device_id;
  };
  const revoke = async (childId: string, deviceId: string) => {
    const res = await app.request(
      `${base}/children/${childId}/devices/${deviceId}`,
      asParent(clerkUserId, { method: 'DELETE' }),
    );
    expect(res.status).toBe(200);
  };
  return {
    householdId,
    addChild,
    addChore,
    deleteChore,
    joinDevice,
    revoke,
    setPin: () => setTestPin(app, clerkUserId, householdId),
  };
}

describe('/me setup facts', () => {
  it('a parent with no household has nothing set up and created nothing', async () => {
    const setup = await setupOf('user_setup_none');
    expect(setup).toEqual({
      hasHousehold: false,
      childCount: 0,
      choreCount: 0,
      hasPin: false,
      deviceEverJoined: false,
      createdHousehold: false,
    });
    expect(nextSetupStep(setup)).toBe('household');
  });

  it('a household with a child but no chore', async () => {
    const h = await household('user_setup_child');
    expect(nextSetupStep(await setupOf('user_setup_child'))).toBe('child');
    await h.addChild();
    const setup = await setupOf('user_setup_child');
    expect(setup).toEqual({
      hasHousehold: true,
      childCount: 1,
      choreCount: 0,
      hasPin: false,
      deviceEverJoined: false,
      createdHousehold: true,
    });
    expect(nextSetupStep(setup)).toBe('chore');
  });

  it('a household with a chore but no PIN, and one whose only chore is deleted', async () => {
    const h = await household('user_setup_chore');
    const choreId = await h.addChore(await h.addChild());
    const setup = await setupOf('user_setup_chore');
    expect(setup).toMatchObject({ choreCount: 1, hasPin: false });
    expect(nextSetupStep(setup)).toBe('pin');

    await h.deleteChore(choreId);
    const deleted = await setupOf('user_setup_chore');
    expect(deleted.choreCount).toBe(0);
    expect(nextSetupStep(deleted)).toBe('chore');
  });

  it('a household with a PIN but no device', async () => {
    const h = await household('user_setup_pin');
    await h.addChore(await h.addChild());
    await h.setPin();
    const setup = await setupOf('user_setup_pin');
    expect(setup).toMatchObject({ hasPin: true, deviceEverJoined: false });
    expect(nextSetupStep(setup)).toBe('join_code');
  });

  it('a household whose only device is revoked is still done', async () => {
    const h = await household('user_setup_revoked');
    const childId = await h.addChild();
    const choreId = await h.addChore(childId);
    await h.setPin();
    const deviceId = await h.joinDevice(childId);
    expect(nextSetupStep(await setupOf('user_setup_revoked'))).toBe('done');

    await h.revoke(childId, deviceId);
    await h.deleteChore(choreId);
    const setup = await setupOf('user_setup_revoked');
    expect(setup).toMatchObject({ deviceEverJoined: true, choreCount: 0 });
    expect(nextSetupStep(setup)).toBe('done');
  });

  it('an invited Partner sees the same facts but did not create the household', async () => {
    const h = await household('user_setup_creator');
    await h.addChild();
    const invited = await app.request(
      `/households/${h.householdId}/parents`,
      asParent('user_setup_creator', {
        method: 'POST',
        body: JSON.stringify({ email: 'partner@setup.test' }),
      }),
    );
    expect(invited.status).toBe(201);

    const partner = await setupOf('user_partner_at_setup.test');
    expect(partner).toEqual({
      hasHousehold: true,
      childCount: 1,
      choreCount: 0,
      hasPin: false,
      deviceEverJoined: false,
      createdHousehold: false,
    });
    expect((await setupOf('user_setup_creator')).createdHousehold).toBe(true);
  });
});
