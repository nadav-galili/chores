import { beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import type { ChildDevice } from '@chores/shared';
import { createApp } from './app.ts';
import type { Db } from './db/client.ts';
import { childDevices } from './db/schema.ts';
import { asParent, fakeVerifyToken } from './test/auth.ts';
import { freshDb } from './test/db.ts';
import { setupHousehold } from './test/household.ts';

let db: Db;
let app: ReturnType<typeof createApp>;

beforeAll(async () => {
  db = await freshDb();
  app = createApp(db, {
    verifyToken: fakeVerifyToken,
    redeemLimit: { max: 1000, windowMs: 60_000 },
  });
});

const list = (clerkUserId: string, householdId: string, childId: string) =>
  app.request(`/households/${householdId}/children/${childId}/devices`, asParent(clerkUserId));

const listed = async (clerkUserId: string, householdId: string, childId: string) =>
  (await (await list(clerkUserId, householdId, childId)).json()) as ChildDevice[];

const revoke = (clerkUserId: string, householdId: string, childId: string, deviceId: string) =>
  app.request(
    `/households/${householdId}/children/${childId}/devices/${deviceId}`,
    asParent(clerkUserId, { method: 'DELETE' }),
  );

describe('a child’s devices', () => {
  it('returns platform, last seen and revoked-at, and never a token or hash', async () => {
    const { householdId, noa } = await setupHousehold(app, 'user_devices_shape');
    const [row] = await db
      .select()
      .from(childDevices)
      .where(eq(childDevices.id, noa.session.device_id));

    const res = await list('user_devices_shape', householdId, noa.id);
    expect(res.status).toBe(200);
    const body = (await res.json()) as ChildDevice[];
    expect(body).toHaveLength(1);
    expect(Object.keys(body[0]!).sort()).toEqual(['id', 'last_seen_at', 'platform', 'revoked_at']);
    expect(body[0]).toMatchObject({
      id: noa.session.device_id,
      platform: 'android',
      revoked_at: null,
    });
    expect(Date.parse(body[0]!.last_seen_at)).toBeGreaterThan(0);

    // Nothing secret crosses: not the token, not its hash, not the child's analytics identity
    // (ADR-0009), not the push token.
    const payload = JSON.stringify(body);
    expect(payload).not.toContain(noa.session.device_token);
    expect(payload).not.toContain(row!.tokenHash);
    expect(payload).not.toContain(row!.analyticsAnonId);
    expect(payload).not.toContain(noa.session.analytics_anon_id);
  });

  it('is scoped to the household and the child', async () => {
    const { householdId, noa, ori } = await setupHousehold(app, 'user_devices_scope_a');
    const other = await setupHousehold(app, 'user_devices_scope_b');

    // A sibling's devices are a different list, not the same one filtered in the UI.
    expect((await listed('user_devices_scope_a', householdId, noa.id)).map((d) => d.id)).toEqual([
      noa.session.device_id,
    ]);
    expect((await listed('user_devices_scope_a', householdId, ori.id)).map((d) => d.id)).toEqual([
      ori.session.device_id,
    ]);

    // Another household's child under this household's id lists nothing, and that household's
    // own id is not this parent's to ask about.
    expect(await listed('user_devices_scope_a', householdId, other.noa.id)).toEqual([]);
    expect((await list('user_devices_scope_a', other.householdId, other.noa.id)).status).toBe(404);
  });

  it('needs a signed-in parent', async () => {
    const { householdId, noa } = await setupHousehold(app, 'user_devices_anon');
    const res = await app.request(`/households/${householdId}/children/${noa.id}/devices`);
    expect(res.status).toBe(401);
  });

  it('shows a revoked device as revoked rather than hiding it', async () => {
    const { householdId, noa } = await setupHousehold(app, 'user_devices_revoked');
    const res = await revoke('user_devices_revoked', householdId, noa.id, noa.session.device_id);
    expect(res.status).toBe(200);

    const body = await listed('user_devices_revoked', householdId, noa.id);
    expect(body).toHaveLength(1);
    expect(body[0]!.revoked_at).not.toBeNull();
  });

  it('revoking twice is idempotent', async () => {
    const { householdId, noa } = await setupHousehold(app, 'user_devices_twice');
    const first = (await (
      await revoke('user_devices_twice', householdId, noa.id, noa.session.device_id)
    ).json()) as { revoked_at: string };
    const second = (await (
      await revoke('user_devices_twice', householdId, noa.id, noa.session.device_id)
    ).json()) as { revoked_at: string };
    expect(second.revoked_at).toBe(first.revoked_at);

    const body = await listed('user_devices_twice', householdId, noa.id);
    expect(body).toHaveLength(1);
    expect(body[0]!.revoked_at).toBe(first.revoked_at);
  });
});
