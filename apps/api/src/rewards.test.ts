import {
  BUILTIN_REWARDS,
  builtinRewardId,
  uuid7,
  type DeviceSession,
  type Reward,
} from '@chores/shared';
import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { createApp } from './app.ts';
import type { Db } from './db/client.ts';
import { rewards } from './db/schema.ts';
import { asParent, fakeVerifyToken } from './test/auth.ts';
import { freshDb } from './test/db.ts';
import { setupHousehold, syncAs } from './test/household.ts';

let db: Db;
let app: ReturnType<typeof createApp>;

beforeAll(async () => {
  db = await freshDb();
  app = createApp(db, {
    verifyToken: fakeVerifyToken,
    redeemLimit: { max: 1000, windowMs: 60_000 },
  });
});

const catalogOf = (householdId: string) =>
  db.select().from(rewards).where(eq(rewards.householdId, householdId));

/** The catalog as the parent's own screen reads it. */
async function listRewards(user: string, householdId: string) {
  const res = await app.request(`/households/${householdId}/rewards`, asParent(user));
  return { status: res.status, body: (await res.json()) as Reward[] };
}

/** Hiding or re-showing one row of it. */
async function setActive(user: string, householdId: string, rewardId: string, active: boolean) {
  const res = await app.request(
    `/households/${householdId}/rewards/${rewardId}`,
    asParent(user, { method: 'PATCH', body: JSON.stringify({ active }) }),
  );
  return { status: res.status, body: (await res.json()) as Reward };
}

/** Every change a device can pull, following the cursor to the end of the log. */
async function pullAll(session: DeviceSession) {
  const changes = [];
  let cursor = 0;
  for (;;) {
    const { body } = await syncAs(app, session, [], cursor);
    changes.push(...body.changes);
    cursor = body.cursor;
    if (!body.has_more) return changes;
  }
}

describe('creating a household', () => {
  it('copies the built-in catalog into it — keys and costs, never titles', async () => {
    const { householdId } = await setupHousehold(app, 'user_catalog');
    const rows = (await catalogOf(householdId)).sort((a, b) => a.sort - b.sort);
    expect(rows.map((r) => [r.builtinKey, r.costCoins])).toEqual([
      ['snack', 50],
      ['screen_time', 150],
      ['friday_dinner', 400],
    ]);
    for (const row of rows) {
      expect(row.title).toBeNull();
      expect(row.isBuiltin).toBe(true);
      expect(row.active).toBe(true);
      expect(row.householdId).toBe(householdId);
    }
  });

  it('gives each household its own rows, so two households never mix', async () => {
    const mine = await setupHousehold(app, 'user_mine');
    const theirs = await setupHousehold(app, 'user_theirs');
    const mineRows = await catalogOf(mine.householdId);
    const theirRows = await catalogOf(theirs.householdId);
    expect(mineRows).toHaveLength(BUILTIN_REWARDS.length);
    expect(theirRows).toHaveLength(BUILTIN_REWARDS.length);
    const ids = new Set([...mineRows, ...theirRows].map((r) => r.id));
    expect(ids.size).toBe(mineRows.length + theirRows.length);
  });
});

describe('the rewards screen', () => {
  it('lists the household’s built-ins in catalog order with their current state', async () => {
    const { householdId } = await setupHousehold(app, 'user_list');
    const { status, body } = await listRewards('user_list', householdId);
    expect(status).toBe(200);
    expect(body.map((r) => [r.builtin_key, r.cost_coins, r.active])).toEqual(
      BUILTIN_REWARDS.map((r) => [r.builtin_key, r.cost_coins, true]),
    );
    expect(body.every((r) => r.is_builtin && r.title === null)).toBe(true);
  });

  it('does not answer for a household that is not the caller’s', async () => {
    const mine = await setupHousehold(app, 'user_peek_mine');
    await setupHousehold(app, 'user_peek_theirs');
    const { status } = await listRewards('user_peek_theirs', mine.householdId);
    expect(status).toBe(404);
  });
});

describe('hiding a built-in', () => {
  it('is `active = false` on the household’s own row, and shows again when toggled back', async () => {
    const { householdId } = await setupHousehold(app, 'user_hide');
    const snack = builtinRewardId(householdId, 'snack');

    const hidden = await setActive('user_hide', householdId, snack, false);
    expect(hidden.status).toBe(200);
    expect(hidden.body).toMatchObject({ id: snack, active: false });
    expect(
      (await listRewards('user_hide', householdId)).body.filter((r) => !r.active),
    ).toHaveLength(1);

    await setActive('user_hide', householdId, snack, true);
    expect((await listRewards('user_hide', householdId)).body.every((r) => r.active)).toBe(true);
  });

  it('leaves another household’s catalog untouched', async () => {
    const mine = await setupHousehold(app, 'user_toggle_mine');
    const theirs = await setupHousehold(app, 'user_toggle_theirs');
    await setActive(
      'user_toggle_mine',
      mine.householdId,
      builtinRewardId(mine.householdId, 'snack'),
      false,
    );

    expect(
      (await listRewards('user_toggle_theirs', theirs.householdId)).body.every((r) => r.active),
    ).toBe(true);
    expect((await catalogOf(theirs.householdId)).every((r) => r.active)).toBe(true);
  });

  it('cannot reach a reward the caller’s household does not own', async () => {
    const mine = await setupHousehold(app, 'user_cross_mine');
    const theirs = await setupHousehold(app, 'user_cross_theirs');
    const theirSnack = builtinRewardId(theirs.householdId, 'snack');
    const res = await app.request(
      `/households/${mine.householdId}/rewards/${theirSnack}`,
      asParent('user_cross_mine', { method: 'PATCH', body: JSON.stringify({ active: false }) }),
    );
    expect(res.status).toBe(404);
    expect((await catalogOf(theirs.householdId)).every((r) => r.active)).toBe(true);
  });

  it('is 404 for an id no reward has, and 400 for a body that says nothing', async () => {
    const { householdId } = await setupHousehold(app, 'user_bad');
    const missing = await app.request(
      `/households/${householdId}/rewards/${uuid7()}`,
      asParent('user_bad', { method: 'PATCH', body: JSON.stringify({ active: false }) }),
    );
    expect(missing.status).toBe(404);
    const empty = await app.request(
      `/households/${householdId}/rewards/${builtinRewardId(householdId, 'snack')}`,
      asParent('user_bad', { method: 'PATCH', body: JSON.stringify({}) }),
    );
    expect(empty.status).toBe(400);
  });
});

describe('the change log', () => {
  it('carries the catalog to a Kid Device, whose rows name no child', async () => {
    const { householdId, noa } = await setupHousehold(app, 'user_reach');
    const seen = (await pullAll(noa.session)).filter((c) => c.table === 'rewards');
    expect(seen.map((c) => c.row.builtin_key).sort()).toEqual(
      BUILTIN_REWARDS.map((r) => r.builtin_key).sort(),
    );
    for (const change of seen) {
      expect(change.op).toBe('insert');
      expect(change.row).toMatchObject({ household_id: householdId, title: null });
    }
  });

  it('carries a hidden built-in as an update, so the shop stops offering it', async () => {
    const { householdId, noa } = await setupHousehold(app, 'user_reach_hide');
    const cursor = (await syncAs(app, noa.session, [], 0)).body.cursor;
    const snack = builtinRewardId(householdId, 'snack');
    await setActive('user_reach_hide', householdId, snack, false);

    const { body } = await syncAs(app, noa.session, [], cursor);
    const change = body.changes.find((c) => c.table === 'rewards' && c.row_id === snack);
    expect(change?.op).toBe('update');
    expect(change?.row).toMatchObject({ active: false });
  });

  it('keeps a sibling’s catalog out by keeping the other household out', async () => {
    const mine = await setupHousehold(app, 'user_scope_mine');
    const theirs = await setupHousehold(app, 'user_scope_theirs');
    const theirIds = new Set((await catalogOf(theirs.householdId)).map((r) => r.id));
    const seen = await pullAll(mine.noa.session);
    expect(seen.filter((c) => theirIds.has(c.row_id))).toEqual([]);
  });
});
