import { BUILTIN_REWARDS, builtinRewardId, type DeviceSession } from '@chores/shared';
import { and, eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { createApp } from './app.ts';
import type { Db } from './db/client.ts';
import { rewards } from './db/schema.ts';
import { fakeVerifyToken } from './test/auth.ts';
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

describe('hiding a built-in', () => {
  it('is `active = false` on that household’s own row and no one else’s', async () => {
    const mine = await setupHousehold(app, 'user_hide_mine');
    const theirs = await setupHousehold(app, 'user_hide_theirs');
    await db
      .update(rewards)
      .set({ active: false, updatedAt: new Date() })
      .where(
        and(
          eq(rewards.householdId, mine.householdId),
          eq(rewards.id, builtinRewardId(mine.householdId, 'snack')),
        ),
      );

    const hidden = (await catalogOf(mine.householdId)).filter((r) => !r.active);
    expect(hidden.map((r) => r.builtinKey)).toEqual(['snack']);
    expect((await catalogOf(theirs.householdId)).every((r) => r.active)).toBe(true);
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
    await db
      .update(rewards)
      .set({ active: false, updatedAt: new Date() })
      .where(eq(rewards.id, snack));

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
