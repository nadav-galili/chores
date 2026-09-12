import { beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { uuid7 } from '@chores/shared';
import { createApp } from './app.ts';
import type { Db } from './db/client.ts';
import { parents } from './db/schema.ts';
import { asParent, fakeVerifyToken } from './test/auth.ts';
import { freshDb } from './test/db.ts';

let db: Db;
let app: ReturnType<typeof createApp>;

beforeAll(async () => {
  db = await freshDb();
  app = createApp(db, { verifyToken: fakeVerifyToken });
});

type Chore = {
  id: string;
  title: string;
  kind: string;
  weekday_mask: number | null;
  due_date: string | null;
  assignees: string[];
  version: number;
  updated_at: string;
  updated_by: string;
  deleted_at: string | null;
};

const t1 = '2026-09-09T10:00:00.000Z';
const t2 = '2026-09-09T11:00:00.000Z';

/** A household with two children and, optionally, a second parent added straight to the table. */
async function setup(clerkUserId: string, secondParent?: string) {
  const res = await app.request(
    '/households',
    asParent(clerkUserId, {
      method: 'POST',
      body: JSON.stringify({ name: 'Galili', tz: 'Asia/Jerusalem', currency: 'ILS' }),
    }),
  );
  const { household, parent } = (await res.json()) as {
    household: { id: string };
    parent: { id: string };
  };
  const childIds: string[] = [];
  for (const first_name of ['Noa', 'Ori']) {
    const c = await app.request(
      `/households/${household.id}/children`,
      asParent(clerkUserId, {
        method: 'POST',
        body: JSON.stringify({ first_name, ui_mode: 'big', pet_name: 'Pip' }),
      }),
    );
    childIds.push(((await c.json()) as { id: string }).id);
  }
  let secondParentId: string | null = null;
  if (secondParent) {
    secondParentId = uuid7();
    await db
      .insert(parents)
      .values({ id: secondParentId, householdId: household.id, clerkUserId: secondParent });
  }
  const base = `/households/${household.id}/chores`;
  const put = (who: string, choreId: string, fields: Record<string, unknown>, updated_at = t1) =>
    app.request(
      `${base}/${choreId}`,
      asParent(who, { method: 'PUT', body: JSON.stringify({ fields, updated_at }) }),
    );
  const list = async (who = clerkUserId) =>
    (await (await app.request(base, asParent(who))).json()) as Chore[];
  return { household, parent, secondParentId, childIds, base, put, list };
}

const daily = (assignees: string[]) => ({ title: 'Dishes', kind: 'daily', assignees });

describe('migrations', () => {
  it('create chores, chore_assignees and change_log', async () => {
    const rows = await db.execute<{ table_name: string }>(
      sql`select table_name from information_schema.tables where table_schema = 'public'`,
    );
    const names = rows.map((r) => r.table_name);
    for (const t of ['chores', 'chore_assignees', 'change_log']) expect(names).toContain(t);
  });
});

describe('upsert_chore', () => {
  it('creates a chore from a full op and lists it with its assignees', async () => {
    const s = await setup('user_amit');
    const id = uuid7();
    const res = await s.put('user_amit', id, { ...daily(s.childIds), icon: '🍽️' });
    expect(res.status).toBe(201);
    const chore = (await res.json()) as Chore;
    expect(chore).toMatchObject({
      id,
      title: 'Dishes',
      kind: 'daily',
      version: 1,
      updated_at: t1,
      updated_by: s.parent.id,
      deleted_at: null,
    });
    expect([...chore.assignees].sort()).toEqual([...s.childIds].sort());

    const listed = await s.list();
    expect(listed.map((c) => c.id)).toEqual([id]);
  });

  it('two parents editing different fields both land, and the version bumps once per edit', async () => {
    const s = await setup('user_ben', 'user_ben2');
    const id = uuid7();
    await s.put('user_ben', id, daily([s.childIds[0]!]));

    // The second parent's later edit (assignees) arrives before the first parent's earlier edit (title).
    const b = await s.put('user_ben2', id, { assignees: s.childIds }, t2);
    expect(b.status).toBe(200);
    expect((await b.json()) as Chore).toMatchObject({ version: 2, updated_by: s.secondParentId });

    const a = await s.put('user_ben', id, { title: 'Wash dishes' }, t1);
    expect(a.status).toBe(200);
    const merged = (await a.json()) as Chore;
    expect(merged.title).toBe('Wash dishes');
    expect([...merged.assignees].sort()).toEqual([...s.childIds].sort());
    expect(merged.version).toBe(3);
    expect(merged.updated_at).toBe(t2);
  });

  it('on the same field the later writer wins and a stale op does not bump the version', async () => {
    const s = await setup('user_chen');
    const id = uuid7();
    await s.put('user_chen', id, daily(s.childIds));
    await s.put('user_chen', id, { title: 'Later' }, t2);
    const stale = await s.put('user_chen', id, { title: 'Earlier' }, t1);
    expect(stale.status).toBe(200);
    expect((await stale.json()) as Chore).toMatchObject({ title: 'Later', version: 2 });
  });

  it('rejects a weekdays chore with an empty mask, on create and on edit', async () => {
    const s = await setup('user_dana');
    const id = uuid7();
    const create = await s.put('user_dana', id, {
      ...daily(s.childIds),
      kind: 'weekdays',
      weekday_mask: 0,
    });
    expect(create.status).toBe(400);
    expect(await s.list()).toEqual([]);

    await s.put('user_dana', id, daily(s.childIds));
    const edit = await s.put('user_dana', id, { kind: 'weekdays' }, t2);
    expect(edit.status).toBe(400);
    expect((await s.list())[0]).toMatchObject({ kind: 'daily', version: 1 });
  });

  it('rejects a partial op for a chore that does not exist yet', async () => {
    const s = await setup('user_eli');
    expect((await s.put('user_eli', uuid7(), { title: 'Dishes' })).status).toBe(400);
  });

  it('rejects an assignee that is not a child of the household', async () => {
    const s = await setup('user_fay');
    const other = await setup('user_fay2');
    const res = await s.put('user_fay', uuid7(), daily([other.childIds[0]!]));
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe('unknown_assignee');
  });
});

describe('delete_chore', () => {
  it('is a soft delete: the row stays with deleted_at set and leaves the list', async () => {
    const s = await setup('user_gil');
    const id = uuid7();
    await s.put('user_gil', id, daily(s.childIds));
    const res = await app.request(
      `${s.base}/${id}`,
      asParent('user_gil', { method: 'DELETE', body: JSON.stringify({ updated_at: t2 }) }),
    );
    expect(res.status).toBe(200);
    const deleted = (await res.json()) as Chore;
    expect(deleted.deleted_at).toBe(t2);
    expect(deleted.version).toBe(2);
    expect(await s.list()).toEqual([]);

    const rows = await db.execute<{ deleted_at: Date | null }>(
      sql`select deleted_at from chores where id = ${id}`,
    );
    expect(rows.length).toBe(1);
    expect(rows[0]!.deleted_at).not.toBeNull();
  });

  it('a later edit to a deleted chore lands on its fields but never brings it back', async () => {
    const s = await setup('user_hana');
    const id = uuid7();
    await s.put('user_hana', id, daily(s.childIds));
    await app.request(
      `${s.base}/${id}`,
      asParent('user_hana', { method: 'DELETE', body: JSON.stringify({ updated_at: t1 }) }),
    );
    const edit = await s.put('user_hana', id, { title: 'Renamed offline' }, t2);
    expect(edit.status).toBe(200);
    expect((await edit.json()) as Chore).toMatchObject({
      title: 'Renamed offline',
      deleted_at: t1,
    });
    expect(await s.list()).toEqual([]);
  });

  it('deleting twice is a no-op and an unknown chore is 404', async () => {
    const s = await setup('user_hadar');
    const id = uuid7();
    await s.put('user_hadar', id, daily(s.childIds));
    const del = () =>
      app.request(
        `${s.base}/${id}`,
        asParent('user_hadar', { method: 'DELETE', body: JSON.stringify({ updated_at: t2 }) }),
      );
    await del();
    const again = await del();
    expect(again.status).toBe(200);
    expect(((await again.json()) as Chore).version).toBe(2);
    const missing = await app.request(
      `${s.base}/${uuid7()}`,
      asParent('user_hadar', { method: 'DELETE', body: JSON.stringify({ updated_at: t2 }) }),
    );
    expect(missing.status).toBe(404);
  });
});

describe('change_log', () => {
  it('is written by trigger for every chore and assignee change', async () => {
    const s = await setup('user_ido');
    const id = uuid7();
    await s.put('user_ido', id, daily([s.childIds[0]!]));
    await s.put('user_ido', id, { assignees: [s.childIds[1]!] }, t2);
    await app.request(
      `${s.base}/${id}`,
      asParent('user_ido', { method: 'DELETE', body: JSON.stringify({ updated_at: t2 }) }),
    );

    const rows = await db.execute<{
      table: string;
      op: string;
      child_id: string | null;
      row_id: string;
      household_id: string;
    }>(sql`select "table", op, child_id, row_id, household_id from change_log
           where household_id = ${s.household.id} order by seq`);
    expect(rows.map((r) => [r.table, r.op, r.child_id])).toEqual([
      // The built-in catalog is copied in when the household is created, before anything else
      // exists. A reward belongs to a household and to no child, so it carries no child id.
      ['rewards', 'insert', null],
      ['rewards', 'insert', null],
      ['rewards', 'insert', null],
      // A child's own row is scoped to that child, so its kid device can pull it.
      ['children', 'insert', s.childIds[0]],
      ['children', 'insert', s.childIds[1]],
      ['chores', 'insert', null],
      ['chore_assignees', 'insert', s.childIds[0]],
      ['chores', 'update', null],
      ['chore_assignees', 'delete', s.childIds[0]],
      ['chore_assignees', 'insert', s.childIds[1]],
      ['chores', 'update', null],
    ]);
    const rewardIds = rows.filter((r) => r.table === 'rewards').map((r) => r.row_id);
    expect(new Set(rows.map((r) => r.row_id))).toEqual(new Set([id, ...s.childIds, ...rewardIds]));
  });
});

describe('sibling households', () => {
  it('cannot read or write another household’s chores', async () => {
    const mine = await setup('user_jon');
    const theirs = await setup('user_kim');
    const id = uuid7();
    await theirs.put('user_kim', id, daily(theirs.childIds));
    expect((await app.request(theirs.base, asParent('user_jon'))).status).toBe(404);
    expect((await mine.put('user_jon', id, { title: 'Mine now' }, t2)).status).toBe(404);
    expect((await theirs.list())[0]?.title).toBe('Dishes');
  });
});
