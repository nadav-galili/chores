import { beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import {
  addDays,
  choreDate,
  historyWindow,
  instanceId,
  uuid7,
  type DeviceSession,
  type IsoDate,
  type ParentWeek,
  type SyncResponse,
} from '@chores/shared';
import { createApp } from './app.ts';
import type { Db } from './db/client.ts';
import { choreInstances, households } from './db/schema.ts';
import { writeHouseholdInstances } from './materialize.ts';
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

const TZ = 'Asia/Jerusalem';

/** A household with two children, a kid device for the first, and chores written by the parent. */
async function setup(clerkUserId: string, opts: { tz?: string; boundary?: number } = {}) {
  const tz = opts.tz ?? TZ;
  const { household } = (await (
    await app.request(
      '/households',
      asParent(clerkUserId, {
        method: 'POST',
        body: JSON.stringify({ name: 'Galili', tz, currency: 'ILS' }),
      }),
    )
  ).json()) as { household: { id: string } };
  await setTestPin(app, clerkUserId, household.id);
  const boundary = opts.boundary ?? 0;
  if (boundary !== 0) {
    await db
      .update(households)
      .set({ dayBoundaryHour: boundary })
      .where(eq(households.id, household.id));
  }

  const child = async (first_name: string) =>
    (await (
      await app.request(
        `/households/${household.id}/children`,
        asParent(clerkUserId, {
          method: 'POST',
          body: JSON.stringify({ first_name, ui_mode: 'little', pet_name: 'Pip' }),
        }),
      )
    ).json()) as { id: string };
  const noa = await child('Noa');
  const ori = await child('Ori');

  const putChore = async (fields: Record<string, unknown>) => {
    const id = uuid7();
    const res = await app.request(
      `/households/${household.id}/chores/${id}`,
      asParent(clerkUserId, {
        method: 'PUT',
        body: JSON.stringify({ fields, updated_at: new Date().toISOString() }),
      }),
    );
    expect([200, 201]).toContain(res.status);
    return id;
  };

  const issued = (await (
    await app.request(
      `/households/${household.id}/children/${noa.id}/join-code`,
      asParent(clerkUserId, { method: 'POST' }),
    )
  ).json()) as { code: string };
  const session = (await (
    await app.request('/join-codes/redeem', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: issued.code, platform: 'android' }),
    })
  ).json()) as DeviceSession;

  return {
    householdId: household.id,
    noa,
    ori,
    putChore,
    session,
    today: () => choreDate(new Date(), tz, boundary),
  };
}

/**
 * One `complete` op on a Chore Date that may be days old. A `due` instance the server already
 * materialized accepts its own date however far back it is (apps/api/src/apply-ops.ts) — only a
 * redo is held to the Redo Window — which is what lets this file seed history at all.
 */
async function complete(session: DeviceSession, choreId: string, chore_date: IsoDate) {
  const completionId = uuid7();
  const res = await app.request('/sync', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${session.device_token}`,
    },
    body: JSON.stringify({
      device_id: session.device_id,
      cursor: 0,
      ops: [
        {
          op_id: uuid7(),
          type: 'complete',
          payload: {
            chore_id: choreId,
            completion_id: completionId,
            completed_at: new Date().toISOString(),
            chore_date,
          },
        },
      ],
    }),
  });
  const body = (await res.json()) as SyncResponse;
  expect(body.rejected).toEqual([]);
  return completionId;
}

const getWeek = async (
  clerkUserId: string,
  householdId: string,
  childId: string,
  from?: IsoDate,
) => {
  const res = await app.request(
    `/households/${householdId}/children/${childId}/week${from ? `?from=${from}` : ''}`,
    asParent(clerkUserId),
  );
  return { status: res.status, body: (await res.json()) as ParentWeek };
};

const statusOf = async (id: string) =>
  (await db.query.choreInstances.findFirst({ where: eq(choreInstances.id, id) }))?.status;

describe('GET /households/:id/children/:id/week', () => {
  it('returns the seven chore dates and one row per chore with an instance in them', async () => {
    const owner = 'user_week_at_example.com';
    const { householdId, noa, putChore, session, today } = await setup(owner);
    const dishes = await putChore({ title: 'Dishes', kind: 'daily', assignees: [noa.id] });
    const bed = await putChore({ title: 'Bed', icon: '🛏️', kind: 'daily', assignees: [noa.id] });

    const threeAgo = addDays(today(), -3);
    await writeHouseholdInstances(db, householdId, threeAgo);
    await writeHouseholdInstances(db, householdId, today());
    const completionId = await complete(session, dishes, threeAgo);

    const { status, body } = await getWeek(owner, householdId, noa.id);
    expect(status).toBe(200);
    expect(body.child_id).toBe(noa.id);
    expect(body.chore_dates).toEqual(historyWindow(today()));
    expect(body.chore_dates).toHaveLength(7);
    expect(body.chores.map((c) => c.title)).toEqual(['Bed', 'Dishes']);

    const dishesRow = body.chores.find((c) => c.chore_id === dishes)!;
    // Sparse by design: two materialized days, two cells.
    expect(dishesRow.cells.map((cell) => cell.chore_date)).toEqual([threeAgo, today()]);
    expect(dishesRow.cells[0]).toEqual({
      instance_id: instanceId(dishes, noa.id, threeAgo),
      chore_date: threeAgo,
      status: 'done',
      completion_id: completionId,
    });
    expect(dishesRow.cells[1]).toMatchObject({ status: 'due', completion_id: null });
    expect(body.chores.find((c) => c.chore_id === bed)).toMatchObject({ icon: '🛏️' });
    expect(body.chores.find((c) => c.chore_id === bed)!.cells).toHaveLength(2);
  });

  it('leaves out a chore whose only instance is older than the window', async () => {
    const owner = 'user_week_old_at_example.com';
    const { householdId, noa, putChore, today } = await setup(owner);
    const tenAgo = addDays(today(), -10);
    const spring = await putChore({
      title: 'Spring clean',
      kind: 'once',
      due_date: tenAgo,
      assignees: [noa.id],
    });
    const dishes = await putChore({ title: 'Dishes', kind: 'daily', assignees: [noa.id] });
    await writeHouseholdInstances(db, householdId, tenAgo);
    await writeHouseholdInstances(db, householdId, today());

    // The one-off's only instance exists, ten days back — outside the free tier's seven.
    expect(await statusOf(instanceId(spring, noa.id, tenAgo))).toBe('due');

    const { body } = await getWeek(owner, householdId, noa.id);
    expect(body.chores.map((c) => c.chore_id)).toEqual([dishes]);
  });

  it('holds only this child’s instances', async () => {
    const owner = 'user_week_child_at_example.com';
    const { householdId, noa, ori, putChore, today } = await setup(owner);
    const dishes = await putChore({ title: 'Dishes', kind: 'daily', assignees: [noa.id] });
    const bed = await putChore({ title: 'Bed', kind: 'daily', assignees: [ori.id] });
    await writeHouseholdInstances(db, householdId, today());

    expect((await getWeek(owner, householdId, noa.id)).body.chores.map((c) => c.chore_id)).toEqual([
      dishes,
    ]);
    expect((await getWeek(owner, householdId, ori.id)).body.chores.map((c) => c.chore_id)).toEqual([
      bed,
    ]);
  });

  it('carries the accepted completion, and rejecting from a cell returns the instance as a redo', async () => {
    const owner = 'user_week_reject_at_example.com';
    const { householdId, noa, putChore, session, today } = await setup(owner);
    const dishes = await putChore({ title: 'Dishes', kind: 'daily', assignees: [noa.id] });
    // Yesterday: inside the Redo Window, which is the day the digest at 20:00 is about.
    const yesterday = addDays(today(), -1);
    await writeHouseholdInstances(db, householdId, yesterday);

    const first = await complete(session, dishes, yesterday);
    await app.request(
      `/households/${householdId}/completions/${first}/reject`,
      asParent(owner, { method: 'POST' }),
    );
    // The child redid it, so the instance is held up by a second, newer accepted completion.
    const second = await complete(session, dishes, yesterday);

    const cell = (await getWeek(owner, householdId, noa.id)).body.chores[0]!.cells[0]!;
    expect(cell).toMatchObject({ chore_date: yesterday, status: 'done', completion_id: second });

    // The same endpoint the today screen calls, named by the id the cell carries.
    const res = await app.request(
      `/households/${householdId}/completions/${cell.completion_id}/reject`,
      asParent(owner, { method: 'POST' }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'rejected' });
    expect(await statusOf(instanceId(dishes, noa.id, yesterday))).toBe('redo');

    const after = (await getWeek(owner, householdId, noa.id)).body.chores[0]!.cells[0]!;
    expect(after).toMatchObject({ status: 'redo', completion_id: null });
  });

  it('ends the window on the household’s own chore date, not on a shared one', async () => {
    // Two households 31 hours apart in effective local time, so their Chore Dates never agree:
    // a server reading its own clock's date, or a fixed zone, gets one of them wrong.
    const early = await setup('user_week_early_at_example.com', {
      tz: 'Pacific/Kiritimati',
      boundary: 0,
    });
    const late = await setup('user_week_late_at_example.com', { tz: 'Pacific/Niue', boundary: 6 });

    const earlyBody = (
      await getWeek('user_week_early_at_example.com', early.householdId, early.noa.id)
    ).body;
    const lateBody = (await getWeek('user_week_late_at_example.com', late.householdId, late.noa.id))
      .body;

    expect(earlyBody.chore_dates).toEqual(historyWindow(early.today()));
    expect(lateBody.chore_dates).toEqual(historyWindow(late.today()));
    expect(earlyBody.chore_dates.at(-1)).not.toBe(lateBody.chore_dates.at(-1));
  });

  it('does not materialize: reading the grid invents no instance for a past day', async () => {
    const owner = 'user_week_readonly_at_example.com';
    const { householdId, noa, putChore } = await setup(owner);
    await putChore({ title: 'Dishes', kind: 'daily', assignees: [noa.id] });

    expect((await getWeek(owner, householdId, noa.id)).body.chores).toEqual([]);
    const rows = await db
      .select({ id: choreInstances.id })
      .from(choreInstances)
      .where(eq(choreInstances.householdId, householdId));
    expect(rows).toEqual([]);
  });

  it('is ungated: a free household with no premium entitlement still gets its seven days', async () => {
    const owner = 'user_week_free_at_example.com';
    const { householdId, noa, putChore, today } = await setup(owner);
    const household = await db.query.households.findFirst({
      where: eq(households.id, householdId),
    });
    expect(household!.entitlement).toBe('free');
    await putChore({ title: 'Dishes', kind: 'daily', assignees: [noa.id] });
    await writeHouseholdInstances(db, householdId, today());

    const { status, body } = await getWeek(owner, householdId, noa.id);
    expect(status).toBe(200);
    expect(body.chore_dates).toHaveLength(7);
    expect(body.chores).toHaveLength(1);
    expect(body).not.toHaveProperty('clamped');
  });

  it('is unchanged for a household that asks for nothing, premium included', async () => {
    // #68: `from` is what asks for more history. A household that sends none gets the seven days
    // it always got and no `clamped` flag — on either tier — so premium does not silently turn
    // the grid into something else and free does not read every load as a refusal.
    const owner = 'user_week_premium_default_at_example.com';
    const { householdId, noa, putChore, today } = await setup(owner);
    await putChore({ title: 'Dishes', kind: 'daily', assignees: [noa.id] });
    await writeHouseholdInstances(db, householdId, addDays(today(), -10));
    await writeHouseholdInstances(db, householdId, today());
    await db
      .update(households)
      .set({ entitlement: 'premium' })
      .where(eq(households.id, householdId));

    const { status, body } = await getWeek(owner, householdId, noa.id);
    expect(status).toBe(200);
    expect(body.chore_dates).toEqual(historyWindow(today()));
    expect(body).not.toHaveProperty('clamped');
  });

  it('clamps a free household asking for older history to seven days and flags the answer', async () => {
    const owner = 'user_week_free_clamped_at_example.com';
    const { householdId, noa, putChore, today } = await setup(owner);
    const dishes = await putChore({ title: 'Dishes', kind: 'daily', assignees: [noa.id] });
    const tenAgo = addDays(today(), -10);
    await writeHouseholdInstances(db, householdId, tenAgo);
    await writeHouseholdInstances(db, householdId, today());

    const { status, body } = await getWeek(owner, householdId, noa.id, tenAgo);
    expect(status).toBe(200);
    expect(body.clamped).toBe(true);
    expect(body.chore_dates).toEqual(historyWindow(today()));
    expect(body.chores.find((chore) => chore.chore_id === dishes)!.cells).toHaveLength(1);
  });

  it('returns the full requested range to a premium household without materializing it', async () => {
    const owner = 'user_week_premium_full_at_example.com';
    const { householdId, noa, putChore, today } = await setup(owner);
    await db
      .update(households)
      .set({ entitlement: 'premium' })
      .where(eq(households.id, householdId));
    const dishes = await putChore({ title: 'Dishes', kind: 'daily', assignees: [noa.id] });
    const tenAgo = addDays(today(), -10);
    await writeHouseholdInstances(db, householdId, tenAgo);
    await writeHouseholdInstances(db, householdId, today());

    const before = await db
      .select({ id: choreInstances.id })
      .from(choreInstances)
      .where(eq(choreInstances.householdId, householdId));
    const { status, body } = await getWeek(owner, householdId, noa.id, tenAgo);
    const after = await db
      .select({ id: choreInstances.id })
      .from(choreInstances)
      .where(eq(choreInstances.householdId, householdId));

    expect(status).toBe(200);
    expect(body.clamped).toBe(false);
    expect(body.chore_dates).toHaveLength(11);
    expect(body.chore_dates[0]).toBe(tenAgo);
    expect(body.chore_dates.at(-1)).toBe(today());
    expect(body.chores.find((chore) => chore.chore_id === dishes)!.cells).toHaveLength(2);
    expect(after).toEqual(before);
  });

  it('is scoped to the caller: another household 404s, another household’s child 404s, no token 401s', async () => {
    const mine = await setup('user_week_scope_at_example.com');
    const theirs = await setup('user_week_scope2_at_example.com');

    expect(
      (await getWeek('user_week_scope2_at_example.com', mine.householdId, mine.noa.id)).status,
    ).toBe(404);
    expect(
      (await getWeek('user_week_scope_at_example.com', mine.householdId, theirs.noa.id)).status,
    ).toBe(404);
    expect(
      (await app.request(`/households/${mine.householdId}/children/${mine.noa.id}/week`)).status,
    ).toBe(401);
  });
});
