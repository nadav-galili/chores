import { beforeAll, describe, expect, it } from 'vitest';
import {
  choreDate,
  instanceId,
  uuid7,
  type DeviceSession,
  type ParentToday,
  type SyncResponse,
} from '@chores/shared';
import { createApp } from './app.ts';
import type { Db } from './db/client.ts';
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
const today = () => choreDate(new Date(), TZ, 0);

/** A household with two children, one of them holding a kid device, and one daily chore each. */
async function setup(clerkUserId: string) {
  const { household } = (await (
    await app.request(
      '/households',
      asParent(clerkUserId, {
        method: 'POST',
        body: JSON.stringify({ name: 'Galili', tz: TZ, currency: 'ILS' }),
      }),
    )
  ).json()) as { household: { id: string } };
  await setTestPin(app, clerkUserId, household.id);

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

  return { householdId: household.id, noa, ori, putChore, session };
}

async function complete(session: DeviceSession, choreId: string, completedAt: string) {
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
            completed_at: completedAt,
            chore_date: today(),
          },
        },
      ],
    }),
  });
  const body = (await res.json()) as SyncResponse;
  expect(body.rejected).toEqual([]);
  return { ...body, completionId };
}

const getToday = async (clerkUserId: string, householdId: string) => {
  const res = await app.request(`/households/${householdId}/today`, asParent(clerkUserId));
  return { status: res.status, body: (await res.json()) as ParentToday };
};

describe('GET /households/:id/today', () => {
  it('shows every child, what is due today and what was done when', async () => {
    const owner = 'user_today_at_example.com';
    const { householdId, noa, ori, putChore, session } = await setup(owner);
    const dishes = await putChore({ title: 'Dishes', kind: 'daily', assignees: [noa.id, ori.id] });
    const bed = await putChore({ title: 'Bed', icon: '🛏️', kind: 'daily', assignees: [noa.id] });

    const doneAt = new Date().toISOString();
    const { completionId } = await complete(session, dishes, doneAt);

    const { status, body } = await getToday(owner, householdId);
    expect(status).toBe(200);
    expect(body.chore_date).toBe(today());
    expect(body.children.map((c) => c.first_name)).toEqual(['Noa', 'Ori']);

    const [noasDay, orisDay] = body.children;
    expect(noasDay).toMatchObject({ child_id: noa.id, due_count: 2, done_count: 1, streak: 0 });
    // Balance after the one chore; the day is not complete, so no bonus yet.
    expect(noasDay!.balance).toBe(10);
    const dishesItem = noasDay!.items.find((i) => i.chore_id === dishes)!;
    expect(dishesItem).toMatchObject({
      instance_id: instanceId(dishes, noa.id, today()),
      title: 'Dishes',
      status: 'done',
      // The completion's id: without it no parent surface can name what it would reject.
      completion_id: completionId,
    });
    expect(Date.parse(dishesItem.completed_at!)).toBe(Date.parse(doneAt));
    expect(noasDay!.items.find((i) => i.chore_id === bed)).toMatchObject({
      title: 'Bed',
      icon: '🛏️',
      status: 'due',
      completed_at: null,
      completion_id: null,
    });

    // Ori has no device and has never synced; the parent still sees today's list, materialized.
    expect(orisDay).toMatchObject({ child_id: ori.id, due_count: 1, done_count: 0, balance: 0 });
    expect(orisDay!.items.map((i) => i.title)).toEqual(['Dishes']);
  });

  it('shows the streak and the bonus once the day is complete', async () => {
    const owner = 'user_streak_at_example.com';
    const { householdId, noa, putChore, session } = await setup(owner);
    const dishes = await putChore({ title: 'Dishes', kind: 'daily', assignees: [noa.id] });
    await complete(session, dishes, new Date().toISOString());

    const { body } = await getToday(owner, householdId);
    const noasDay = body.children.find((c) => c.child_id === noa.id)!;
    expect(noasDay).toMatchObject({ due_count: 1, done_count: 1, streak: 1 });
    expect(noasDay.balance).toBe(30); // 10 earn + 20 day-complete bonus
  });

  it('is scoped to the caller: another household is 404, and no token is 401', async () => {
    const { householdId } = await setup('user_scope_at_example.com');
    expect((await getToday('user_other_at_example.com', householdId)).status).toBe(404);
    expect((await app.request(`/households/${householdId}/today`)).status).toBe(401);
  });
});
