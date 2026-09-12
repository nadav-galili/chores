import { beforeAll, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import type { DeviceSession } from '@chores/shared';
import { createApp } from './app.ts';
import type { Db } from './db/client.ts';
import { childDevices, joinCodes } from './db/schema.ts';
import { asParent, fakeVerifyToken } from './test/auth.ts';
import { freshDb } from './test/db.ts';
import { setTestPin } from './test/household.ts';

let db: Db;
let app: ReturnType<typeof createApp>;

beforeAll(async () => {
  db = await freshDb();
  app = createApp(db, {
    verifyToken: fakeVerifyToken,
    redeemLimit: { max: 1000, windowMs: 60_000 },
  });
});

type Issued = { code: string; child_id: string; expires_at: string };

async function household(clerkUserId: string, ...names: string[]) {
  const res = await app.request(
    '/households',
    asParent(clerkUserId, {
      method: 'POST',
      body: JSON.stringify({ name: 'Galili', tz: 'Asia/Jerusalem', currency: 'ILS' }),
    }),
  );
  const { household } = (await res.json()) as { household: { id: string } };
  await setTestPin(app, clerkUserId, household.id);
  const children: { id: string; first_name: string }[] = [];
  for (const first_name of names) {
    const created = await app.request(
      `/households/${household.id}/children`,
      asParent(clerkUserId, {
        method: 'POST',
        body: JSON.stringify({ first_name, ui_mode: 'little', pet_name: `${first_name}'s pet` }),
      }),
    );
    children.push((await created.json()) as { id: string; first_name: string });
  }
  return { householdId: household.id, children };
}

async function issue(clerkUserId: string, householdId: string, childId: string) {
  const res = await app.request(
    `/households/${householdId}/children/${childId}/join-code`,
    asParent(clerkUserId, { method: 'POST' }),
  );
  expect(res.status).toBe(201);
  return (await res.json()) as Issued;
}

const redeem = (code: string, init: RequestInit = {}) =>
  app.request('/join-codes/redeem', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code, platform: 'android' }),
    ...init,
  });

const asKid = (token: string) => ({ headers: { authorization: `Bearer ${token}` } });

describe('issuing a join code', () => {
  it('returns a 6-char code bound to the child that expires in 15 minutes', async () => {
    const { householdId, children } = await household('user_issue', 'Noa');
    const before = Date.now();
    const issued = await issue('user_issue', householdId, children[0]!.id);
    expect(issued.code).toMatch(/^[A-Z2-9]{6}$/);
    expect(issued.child_id).toBe(children[0]!.id);
    const ttl = new Date(issued.expires_at).getTime() - before;
    expect(ttl).toBeGreaterThan(14 * 60_000);
    expect(ttl).toBeLessThanOrEqual(15 * 60_000 + 1000);
  });

  it('is only for children of the caller’s own household', async () => {
    const { householdId } = await household('user_issue_a');
    const { children: theirs } = await household('user_issue_b', 'Tal');
    const res = await app.request(
      `/households/${householdId}/children/${theirs[0]!.id}/join-code`,
      asParent('user_issue_a', { method: 'POST' }),
    );
    expect(res.status).toBe(404);
  });
});

describe('redeeming a join code', () => {
  it('is public and returns a device token, the child’s basics, tz/boundary and an anon id', async () => {
    const { householdId, children } = await household('user_redeem', 'Noa');
    const issued = await issue('user_redeem', householdId, children[0]!.id);

    const res = await redeem(issued.code.toLowerCase());
    expect(res.status).toBe(201);
    const session = (await res.json()) as DeviceSession;
    expect(session.device_token.length).toBeGreaterThanOrEqual(32);
    expect(session.child).toEqual({
      id: children[0]!.id,
      first_name: 'Noa',
      ui_mode: 'little',
      pet_name: "Noa's pet",
    });
    expect(session.household).toEqual({
      id: householdId,
      tz: 'Asia/Jerusalem',
      day_boundary_hour: 0,
    });
    expect(session.analytics_anon_id).toMatch(/^[0-9a-f-]{36}$/);

    // The token is stored hashed, never in the clear.
    const [device] = await db
      .select()
      .from(childDevices)
      .where(eq(childDevices.id, session.device_id));
    expect(device).toMatchObject({ childId: children[0]!.id, householdId, platform: 'android' });
    expect(device!.tokenHash).not.toContain(session.device_token);
    expect(device!.tokenHash).toHaveLength(64);

    const [code] = await db.select().from(joinCodes).where(eq(joinCodes.code, issued.code));
    expect(code!.redeemedDeviceId).toBe(session.device_id);
    expect(code!.redeemedAt).not.toBeNull();
  });

  it('fails for an unknown code', async () => {
    const res = await redeem('ZZZZZZ');
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'invalid_code' });
  });

  it('fails for an expired code', async () => {
    const { householdId, children } = await household('user_expired', 'Noa');
    const issued = await issue('user_expired', householdId, children[0]!.id);
    await db
      .update(joinCodes)
      .set({ expiresAt: sql`now() - interval '1 second'` })
      .where(eq(joinCodes.code, issued.code));
    const res = await redeem(issued.code);
    expect(res.status).toBe(410);
    expect(await res.json()).toEqual({ error: 'code_expired' });
  });

  it('is single use: the second redeem fails', async () => {
    const { householdId, children } = await household('user_twice', 'Noa');
    const issued = await issue('user_twice', householdId, children[0]!.id);
    expect((await redeem(issued.code)).status).toBe(201);
    const again = await redeem(issued.code);
    expect(again.status).toBe(409);
    expect(await again.json()).toEqual({ error: 'code_redeemed' });
    const devices = await db
      .select()
      .from(childDevices)
      .where(eq(childDevices.childId, children[0]!.id));
    expect(devices).toHaveLength(1);
  });

  it('validates the body', async () => {
    const res = await app.request('/join-codes/redeem', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: 'ABC', platform: 'android' }),
    });
    expect(res.status).toBe(400);
  });

  it('is rate-limited per client', async () => {
    const limited = createApp(db, {
      verifyToken: fakeVerifyToken,
      redeemLimit: { max: 3, windowMs: 60_000 },
    });
    const attempt = (ip: string) =>
      limited.request('/join-codes/redeem', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
        body: JSON.stringify({ code: 'ZZZZZZ', platform: 'android' }),
      });
    for (let i = 0; i < 3; i++) expect((await attempt('10.0.0.1')).status).toBe(404);
    const fourth = await attempt('10.0.0.1');
    expect(fourth.status).toBe(429);
    expect(await fourth.json()).toEqual({ error: 'rate_limited' });
    expect((await attempt('10.0.0.2')).status).toBe(404);
    // A caller-supplied prefix does not open a new bucket; only the proxy-appended address counts.
    expect((await attempt('1.2.3.4, 10.0.0.1')).status).toBe(429);
  });
});

describe('kid device token', () => {
  it('resolves the child context and is scoped to that child only', async () => {
    const { householdId, children } = await household('user_scope', 'Noa', 'Ori');
    const [noa, ori] = children;
    const noaSession = (await (
      await redeem((await issue('user_scope', householdId, noa!.id)).code)
    ).json()) as DeviceSession;
    const oriSession = (await (
      await redeem((await issue('user_scope', householdId, ori!.id)).code)
    ).json()) as DeviceSession;

    const me = await app.request('/device/me', asKid(noaSession.device_token));
    expect(me.status).toBe(200);
    expect(await me.json()).toMatchObject({
      child: { id: noa!.id, first_name: 'Noa' },
      household: { id: householdId },
    });

    // No parameter lets Noa's device address Ori: the child comes from the token alone.
    const other = await app.request(`/device/me?child_id=${ori!.id}`, {
      headers: { ...asKid(noaSession.device_token).headers, 'x-child-id': ori!.id },
    });
    expect(((await other.json()) as DeviceSession).child.id).toBe(noa!.id);
    expect(noaSession.analytics_anon_id).not.toBe(oriSession.analytics_anon_id);

    const oriMe = await app.request('/device/me', asKid(oriSession.device_token));
    expect(((await oriMe.json()) as DeviceSession).child.id).toBe(ori!.id);
  });

  it('refuses missing or unknown tokens', async () => {
    expect((await app.request('/device/me')).status).toBe(401);
    const res = await app.request('/device/me', asKid('not-a-token'));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'unauthenticated' });
  });

  it('refuses a revoked device with 401 device_revoked', async () => {
    const { householdId, children } = await household('user_revoke', 'Noa');
    const session = (await (
      await redeem((await issue('user_revoke', householdId, children[0]!.id)).code)
    ).json()) as DeviceSession;
    expect((await app.request('/device/me', asKid(session.device_token))).status).toBe(200);

    const revoke = await app.request(
      `/households/${householdId}/children/${children[0]!.id}/devices/${session.device_id}`,
      asParent('user_revoke', { method: 'DELETE' }),
    );
    expect(revoke.status).toBe(200);
    expect(await revoke.json()).toMatchObject({ id: session.device_id });

    const res = await app.request('/device/me', asKid(session.device_token));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'device_revoked' });
  });

  it('a parent cannot revoke a device of another household', async () => {
    const { householdId, children } = await household('user_rv_a', 'Noa');
    const session = (await (
      await redeem((await issue('user_rv_a', householdId, children[0]!.id)).code)
    ).json()) as DeviceSession;
    const { householdId: otherHousehold } = await household('user_rv_b');
    const res = await app.request(
      `/households/${otherHousehold}/children/${children[0]!.id}/devices/${session.device_id}`,
      asParent('user_rv_b', { method: 'DELETE' }),
    );
    expect(res.status).toBe(404);
    expect((await app.request('/device/me', asKid(session.device_token))).status).toBe(200);
  });
});
