import { createHmac } from 'node:crypto';
import { builtinRewardId, uuid7 } from '@chores/shared';
import { eq, inArray, sql } from 'drizzle-orm';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from './app.ts';
import type { Db } from './db/client.ts';
import {
  changeLog,
  childDevices,
  children,
  choreAssignees,
  choreInstances,
  chores,
  completions,
  daySummaries,
  growthEntries,
  households,
  joinCodes,
  ledgerEntries,
  parentDevices,
  parentInvites,
  parents,
  redemptions,
  revenuecatEvents,
  rewards,
  xpEvents,
} from './db/schema.ts';
import { asParent, fakeVerifyToken } from './test/auth.ts';
import { freshDb } from './test/db.ts';
import { completeOp, setupHousehold, syncAs } from './test/household.ts';

/**
 * Account Deletion and Household Deletion (ADR-0019). A parent deleting their account while a
 * Partner remains takes only themselves; the last parent takes the household and everything in
 * it, and a kid device learns that on its next `/sync` exactly as it learns of a revoke.
 */

const SECRET = 'rcwhsec_test_only';

let db: Db;
let app: ReturnType<typeof createApp>;
let deletedClerkUsers: string[];
let purgedChildren: string[][];

beforeAll(async () => {
  db = await freshDb();
});

beforeEach(() => {
  deletedClerkUsers = [];
  purgedChildren = [];
  app = createApp(db, {
    verifyToken: fakeVerifyToken,
    revenuecatWebhookSigningSecret: SECRET,
    deleteClerkUser: async (clerkUserId) => {
      deletedClerkUsers.push(clerkUserId);
    },
    purgePhotos: async (childIds) => {
      purgedChildren.push([...childIds].sort());
    },
  });
});

const deleteAccount = (clerkUserId: string) =>
  app.request('/me', asParent(clerkUserId, { method: 'DELETE' }));

/** A household with history in every table the deletion has to reach. */
async function livedInHousehold(owner: string) {
  const fixture = await setupHousehold(app, owner);
  const { householdId, noa, ori } = fixture;
  const dishes = await fixture.addChore('Dishes', [noa.id, ori.id]);
  // Ten taps' worth of coins, so the redemption below is affordable.
  for (let i = 0; i < 6; i++) {
    const extra = await fixture.addChore(`Extra ${i}`, [noa.id]);
    await syncAs(app, noa.session, [completeOp(extra)]);
  }
  const done = completeOp(dishes);
  expect((await syncAs(app, noa.session, [done])).status).toBe(200);
  const redemptionId = uuid7();
  const asked = await syncAs(app, noa.session, [
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
  expect(asked.body.rejected).toEqual([]);
  // The owner's decisions are rows of the household's history that name the owner.
  const rejected = await app.request(
    `/households/${householdId}/completions/${done.payload.completion_id}/reject`,
    asParent(owner, { method: 'POST' }),
  );
  expect(rejected.status).toBe(200);
  const approved = await app.request(
    `/households/${householdId}/redemptions/${redemptionId}/decide`,
    asParent(owner, { method: 'POST', body: JSON.stringify({ decision: 'approve' }) }),
  );
  expect(approved.status).toBe(200);
  await app.request(
    `/households/${householdId}/devices`,
    asParent(owner, {
      method: 'POST',
      body: JSON.stringify({
        expo_push_token: `ExponentPushToken[${owner}]`,
        platform: 'ios',
        locale: 'en',
      }),
    }),
  );
  return fixture;
}

/** Joins `partner` to the owner's household the way a real partner arrives: invite, then sign in. */
async function addPartner(owner: string, householdId: string, partner: string) {
  const email = `${partner.slice('user_'.length).split('_at_')[0]}@example.com`;
  const invited = await app.request(
    `/households/${householdId}/parents`,
    asParent(owner, { method: 'POST', body: JSON.stringify({ email }) }),
  );
  expect(invited.status).toBe(201);
  const me = (await (await app.request('/me', asParent(partner))).json()) as {
    parent: { id: string } | null;
  };
  expect(me.parent).not.toBeNull();
  return me.parent!.id;
}

/** Every row anywhere that belongs to the household, by table. */
async function rowsOf(householdId: string) {
  const childIds = (
    await db.select({ id: children.id }).from(children).where(eq(children.householdId, householdId))
  ).map((c) => c.id);
  const parentIds = (
    await db.select({ id: parents.id }).from(parents).where(eq(parents.householdId, householdId))
  ).map((p) => p.id);
  const choreIds = (
    await db.select({ id: chores.id }).from(chores).where(eq(chores.householdId, householdId))
  ).map((c) => c.id);
  const n = async (q: Promise<unknown[]>) => (await q).length;
  return {
    households: await n(db.select().from(households).where(eq(households.id, householdId))),
    parents: parentIds.length,
    parent_invites: await n(
      db.select().from(parentInvites).where(eq(parentInvites.householdId, householdId)),
    ),
    parent_devices: parentIds.length
      ? await n(db.select().from(parentDevices).where(inArray(parentDevices.parentId, parentIds)))
      : 0,
    children: childIds.length,
    child_devices: await n(
      db.select().from(childDevices).where(eq(childDevices.householdId, householdId)),
    ),
    join_codes: await n(db.select().from(joinCodes).where(eq(joinCodes.householdId, householdId))),
    chores: choreIds.length,
    chore_assignees: choreIds.length
      ? await n(db.select().from(choreAssignees).where(inArray(choreAssignees.choreId, choreIds)))
      : 0,
    chore_instances: await n(
      db.select().from(choreInstances).where(eq(choreInstances.householdId, householdId)),
    ),
    completions: await n(
      db.select().from(completions).where(eq(completions.householdId, householdId)),
    ),
    ledger_entries: await n(
      db.select().from(ledgerEntries).where(eq(ledgerEntries.householdId, householdId)),
    ),
    xp_events: childIds.length
      ? await n(db.select().from(xpEvents).where(inArray(xpEvents.childId, childIds)))
      : 0,
    day_summaries: childIds.length
      ? await n(db.select().from(daySummaries).where(inArray(daySummaries.childId, childIds)))
      : 0,
    growth_entries: await n(
      db.select().from(growthEntries).where(eq(growthEntries.householdId, householdId)),
    ),
    rewards: await n(db.select().from(rewards).where(eq(rewards.householdId, householdId))),
    redemptions: await n(
      db.select().from(redemptions).where(eq(redemptions.householdId, householdId)),
    ),
    revenuecat_events: await n(
      db.select().from(revenuecatEvents).where(eq(revenuecatEvents.householdId, householdId)),
    ),
    change_log: await n(db.select().from(changeLog).where(eq(changeLog.householdId, householdId))),
  };
}

function signed(body: string) {
  const timestamp = Math.floor(Date.now() / 1000);
  const digest = createHmac('sha256', SECRET).update(`${timestamp}.${body}`).digest('hex');
  return {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-revenuecat-webhook-signature': `t=${timestamp},v1=${digest}`,
    },
    body,
  } satisfies RequestInit;
}

const renewal = (id: string, appUserId: string) =>
  JSON.stringify({
    api_version: '1.0',
    event: {
      id,
      type: 'RENEWAL',
      event_timestamp_ms: Date.now(),
      app_user_id: appUserId,
      original_app_user_id: appUserId,
      aliases: [],
      product_id: 'mibo_yearly',
      purchased_at_ms: Date.now(),
      expiration_at_ms: Date.now() + 30 * 24 * 60 * 60 * 1000,
      entitlement_ids: ['premium'],
      environment: 'SANDBOX',
    },
  });

describe('DELETE /me', () => {
  it('requires a signed-in parent', async () => {
    expect((await app.request('/me', { method: 'DELETE' })).status).toBe(401);
  });

  it('with a Partner remaining, removes only the deleting Parent and keeps the household and its history', async () => {
    const owner = 'user_del_owner_at_example.com';
    const partner = 'user_del_partner_at_example.com';
    const fixture = await livedInHousehold(owner);
    await addPartner(owner, fixture.householdId, partner);
    // The partner's own phone, which must go with them.
    await app.request(
      `/households/${fixture.householdId}/devices`,
      asParent(partner, {
        method: 'POST',
        body: JSON.stringify({
          expo_push_token: 'ExponentPushToken[partner]',
          platform: 'android',
          locale: 'en',
        }),
      }),
    );
    const before = await rowsOf(fixture.householdId);

    const res = await deleteAccount(owner);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ household_deleted: false });

    const after = await rowsOf(fixture.householdId);
    expect(after.parents).toBe(1);
    expect(after.parent_devices).toBe(1);
    // Everything that is the household's rather than the owner's is exactly as it was. The
    // change log only grows: nothing in it is the owner's.
    const owners = new Set(['parents', 'parent_devices', 'parent_invites', 'change_log']);
    const keep = (r: typeof before) =>
      Object.fromEntries(Object.entries(r).filter(([table]) => !owners.has(table)));
    expect(keep(after)).toEqual(keep(before));
    expect(after.change_log).toBeGreaterThanOrEqual(before.change_log);
    expect(deletedClerkUsers).toEqual([owner]);
    expect(purgedChildren).toEqual([]);

    // The household carries on: the partner reads it, and a kid device still syncs.
    const me = (await (await app.request('/me', asParent(partner))).json()) as {
      household: { id: string } | null;
    };
    expect(me.household?.id).toBe(fixture.householdId);
    expect((await syncAs(app, fixture.noa.session)).status).toBe(200);
    // The owner is gone: their token reaches no household.
    const gone = (await (await app.request('/me', asParent(owner))).json()) as {
      parent: unknown;
    };
    expect(gone.parent).toBeNull();
  });

  it('a chore the leaving parent wrote can still be edited by the partner who remains', async () => {
    const owner = 'user_del_writer_at_example.com';
    const partner = 'user_del_editor_at_example.com';
    const fixture = await setupHousehold(app, owner);
    const choreId = await fixture.addChore('Dishes', [fixture.noa.id]);
    await addPartner(owner, fixture.householdId, partner);
    expect((await deleteAccount(owner)).status).toBe(200);

    const edited = await app.request(
      `/households/${fixture.householdId}/chores/${choreId}`,
      asParent(partner, {
        method: 'PUT',
        body: JSON.stringify({
          fields: { title: 'Dishes', kind: 'daily', assignees: [fixture.noa.id] },
          updated_at: new Date().toISOString(),
        }),
      }),
    );
    expect(edited.status).toBeLessThan(300);
  });

  it('as the last Parent, removes every household-scoped row, and a kid device is told it is revoked', async () => {
    const owner = 'user_del_last_at_example.com';
    const fixture = await livedInHousehold(owner);
    // A pending invite to someone who never signed in is the household's too.
    await app.request(
      `/households/${fixture.householdId}/parents`,
      asParent(owner, {
        method: 'POST',
        body: JSON.stringify({ email: 'never-came@example.com' }),
      }),
    );
    const before = await rowsOf(fixture.householdId);
    for (const table of [
      'completions',
      'ledger_entries',
      'xp_events',
      'growth_entries',
      'redemptions',
      'child_devices',
      'parent_devices',
      'parent_invites',
      'change_log',
    ] as const) {
      expect(before[table], table).toBeGreaterThan(0);
    }

    const res = await deleteAccount(owner);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ household_deleted: true });

    const after = await rowsOf(fixture.householdId);
    for (const [table, count] of Object.entries(after)) expect(count, table).toBe(0);
    expect(deletedClerkUsers).toEqual([owner]);
    expect(purgedChildren).toEqual([[fixture.noa.id, fixture.ori.id].sort()]);

    const sync = await syncAs(app, fixture.noa.session);
    expect(sync.status).toBe(401);
    expect(sync.body).toEqual({ error: 'device_revoked' });
  });

  it('leaves other households alone', async () => {
    const mine = await setupHousehold(app, 'user_del_mine_at_example.com');
    const theirs = await setupHousehold(app, 'user_del_theirs_at_example.com');
    await mine.addChore('Dishes', [mine.noa.id]);
    await theirs.addChore('Dishes', [theirs.noa.id]);
    const before = await rowsOf(theirs.householdId);

    expect((await deleteAccount('user_del_mine_at_example.com')).status).toBe(200);
    expect(await rowsOf(theirs.householdId)).toEqual(before);
    expect((await syncAs(app, theirs.noa.session)).status).toBe(200);
  });

  it('deletes the Clerk user even when there is no parent row, so a retry after a half-finished deletion completes it', async () => {
    const res = await deleteAccount('user_del_nobody_at_example.com');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ household_deleted: false });
    expect(deletedClerkUsers).toEqual(['user_del_nobody_at_example.com']);
  });

  it('keeps every row when the photos cannot be purged, so the parent can try again', async () => {
    const owner = 'user_del_photofail_at_example.com';
    const fixture = await setupHousehold(app, owner);
    const failing = createApp(db, {
      verifyToken: fakeVerifyToken,
      deleteClerkUser: async (id) => {
        deletedClerkUsers.push(id);
      },
      purgePhotos: () => Promise.reject(new Error('r2 down')),
    });
    const before = await rowsOf(fixture.householdId);
    const res = await failing.request('/me', asParent(owner, { method: 'DELETE' }));
    expect(res.status).toBe(503);
    expect(await rowsOf(fixture.householdId)).toEqual(before);
    expect(deletedClerkUsers).toEqual([]);
  });

  it('answers 503 and deletes nothing when Clerk deletion is not configured', async () => {
    const owner = 'user_del_unconfigured_at_example.com';
    const fixture = await setupHousehold(app, owner);
    const bare = createApp(db, { verifyToken: fakeVerifyToken });
    const before = await rowsOf(fixture.householdId);
    const res = await bare.request('/me', asParent(owner, { method: 'DELETE' }));
    expect(res.status).toBe(503);
    expect(await rowsOf(fixture.householdId)).toEqual(before);
  });
});

describe('a RevenueCat webhook after a Household Deletion', () => {
  it('is acknowledged with 2xx and writes nothing', async () => {
    const owner = 'user_del_rc_at_example.com';
    const fixture = await setupHousehold(app, owner);
    expect((await deleteAccount(owner)).status).toBe(200);
    const eventsBefore = await db.select({ n: sql<number>`count(*)::int` }).from(revenuecatEvents);
    const householdsBefore = await db.select({ n: sql<number>`count(*)::int` }).from(households);

    const res = await app.request('/webhooks/revenuecat', signed(renewal(uuid7(), owner)));
    expect(res.status).toBeGreaterThanOrEqual(200);
    expect(res.status).toBeLessThan(300);

    expect(await db.select({ n: sql<number>`count(*)::int` }).from(revenuecatEvents)).toEqual(
      eventsBefore,
    );
    expect(await db.select({ n: sql<number>`count(*)::int` }).from(households)).toEqual(
      householdsBefore,
    );
    expect(
      await db.select().from(households).where(eq(households.id, fixture.householdId)),
    ).toEqual([]);
  });
});
