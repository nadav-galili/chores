import { beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { createApp } from './app.ts';
import type { Db } from './db/client.ts';
import { asParent, fakeVerifyToken } from './test/auth.ts';
import { freshDb } from './test/db.ts';

let db: Db;
let app: ReturnType<typeof createApp>;

beforeAll(async () => {
  db = await freshDb();
  app = createApp(db, { verifyToken: fakeVerifyToken });
});

const galili = { name: 'Galili', tz: 'Asia/Jerusalem', currency: 'ILS' };

async function createHousehold(clerkUserId: string, body = galili) {
  const res = await app.request(
    '/households',
    asParent(clerkUserId, { method: 'POST', body: JSON.stringify(body) }),
  );
  expect(res.status).toBe(201);
  return (await res.json()) as { household: { id: string }; parent: { id: string } };
}

describe('migrations', () => {
  it('apply from an empty database and create the M1.4 tables', async () => {
    const rows = await db.execute<{ table_name: string }>(
      sql`select table_name from information_schema.tables where table_schema = 'public' order by 1`,
    );
    const names = rows.map((r) => r.table_name);
    for (const t of [
      'households',
      'parents',
      'parent_devices',
      'children',
      'join_codes',
      'child_devices',
    ]) {
      expect(names).toContain(t);
    }
  });
});

describe('auth', () => {
  it('rejects requests without a valid Clerk token', async () => {
    expect((await app.request('/me')).status).toBe(401);
    expect(
      (await app.request('/me', { headers: { authorization: 'Bearer nonsense' } })).status,
    ).toBe(401);
  });
});

describe('first sign-in', () => {
  it('has no household yet, so the client goes to create-household', async () => {
    const res = await app.request('/me', asParent('user_new'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ parent: null, household: null, children: [] });
  });
});

describe('create household', () => {
  it('creates the household and the parent, with the phone timezone and defaults', async () => {
    const { household, parent } = await createHousehold('user_alice');
    expect(household).toMatchObject({
      name: 'Galili',
      tz: 'Asia/Jerusalem',
      currency: 'ILS',
      day_boundary_hour: 0,
      digest_hour: 20,
      entitlement: 'free',
    });
    expect(parent).toMatchObject({ household_id: household.id, clerk_user_id: 'user_alice' });

    const me = await app.request('/me', asParent('user_alice'));
    expect(await me.json()).toMatchObject({ household: { id: household.id }, children: [] });
  });

  it('refuses a second household for the same parent', async () => {
    await createHousehold('user_bob');
    const res = await app.request(
      '/households',
      asParent('user_bob', { method: 'POST', body: JSON.stringify(galili) }),
    );
    expect(res.status).toBe(409);
  });

  it('validates the body', async () => {
    const res = await app.request(
      '/households',
      asParent('user_carol', {
        method: 'POST',
        body: JSON.stringify({ ...galili, tz: 'Mars/Olympus' }),
      }),
    );
    expect(res.status).toBe(400);
  });
});

describe('children', () => {
  const noa = { first_name: 'Noa', ui_mode: 'little', pet_name: 'Pip', reminder_time: '07:30' };

  it('adds a child and lists it in sort order', async () => {
    const { household } = await createHousehold('user_dan');
    const base = `/households/${household.id}/children`;

    const created = await app.request(
      base,
      asParent('user_dan', { method: 'POST', body: JSON.stringify(noa) }),
    );
    expect(created.status).toBe(201);
    const child = (await created.json()) as { id: string; sort: number };
    expect(child).toMatchObject({ ...noa, household_id: household.id, read_only_after: null });

    await app.request(
      base,
      asParent('user_dan', {
        method: 'POST',
        body: JSON.stringify({ first_name: 'Ori', ui_mode: 'big', pet_name: 'Zed' }),
      }),
    );

    const list = await app.request(base, asParent('user_dan'));
    expect(list.status).toBe(200);
    const children = (await list.json()) as { first_name: string; sort: number }[];
    expect(children.map((c) => c.first_name)).toEqual(['Noa', 'Ori']);
    expect(children.map((c) => c.sort)).toEqual([0, 1]);
  });

  it('edits a child', async () => {
    const { household } = await createHousehold('user_eve');
    const base = `/households/${household.id}/children`;
    const created = await app.request(
      base,
      asParent('user_eve', { method: 'POST', body: JSON.stringify(noa) }),
    );
    const { id } = (await created.json()) as { id: string };

    const res = await app.request(
      `${base}/${id}`,
      asParent('user_eve', {
        method: 'PATCH',
        body: JSON.stringify({ ...noa, ui_mode: 'big', pet_name: 'Pippa', reminder_time: null }),
      }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      id,
      ui_mode: 'big',
      pet_name: 'Pippa',
      reminder_time: null,
    });
  });

  it('rejects a child the household does not accept', async () => {
    const { household } = await createHousehold('user_frank');
    const res = await app.request(
      `/households/${household.id}/children`,
      asParent('user_frank', {
        method: 'POST',
        body: JSON.stringify({ ...noa, reminder_time: '25:00' }),
      }),
    );
    expect(res.status).toBe(400);
  });
});

describe('sibling households', () => {
  it('a parent cannot read or write another household', async () => {
    const { household: mine } = await createHousehold('user_gal');
    const { household: theirs } = await createHousehold('user_hila');
    const theirChild = await app.request(
      `/households/${theirs.id}/children`,
      asParent('user_hila', {
        method: 'POST',
        body: JSON.stringify({ first_name: 'Tal', ui_mode: 'big', pet_name: 'Mo' }),
      }),
    );
    const { id: theirChildId } = (await theirChild.json()) as { id: string };

    const read = await app.request(`/households/${theirs.id}/children`, asParent('user_gal'));
    expect(read.status).toBe(404);

    const write = await app.request(
      `/households/${theirs.id}/children`,
      asParent('user_gal', {
        method: 'POST',
        body: JSON.stringify({ first_name: 'X', ui_mode: 'big', pet_name: 'Y' }),
      }),
    );
    expect(write.status).toBe(404);

    // A child id from another household is not reachable through my own household either.
    const edit = await app.request(
      `/households/${mine.id}/children/${theirChildId}`,
      asParent('user_gal', {
        method: 'PATCH',
        body: JSON.stringify({ first_name: 'X', ui_mode: 'big', pet_name: 'Y' }),
      }),
    );
    expect(edit.status).toBe(404);

    const theirList = await app.request(`/households/${theirs.id}/children`, asParent('user_hila'));
    expect(((await theirList.json()) as unknown[]).length).toBe(1);
  });
});
