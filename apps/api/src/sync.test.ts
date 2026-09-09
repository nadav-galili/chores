import { beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import {
  choreDate,
  instanceId,
  type DeviceSession,
  type SyncResponse,
  uuid7,
} from '@chores/shared';
import { createApp } from './app.ts';
import type { Db } from './db/client.ts';
import { choreInstances } from './db/schema.ts';
import { asParent, fakeVerifyToken } from './test/auth.ts';
import { freshDb } from './test/db.ts';

let db: Db;
let app: ReturnType<typeof createApp>;

beforeAll(async () => {
  db = await freshDb();
  app = createApp(db, {
    verifyToken: fakeVerifyToken,
    redeemLimit: { max: 1000, windowMs: 60_000 },
    syncPageSize: 3,
  });
});

const TZ = 'Asia/Jerusalem';
const today = () => choreDate(new Date(), TZ, 0);

/** A household with two children, each with a joined kid device. */
async function setup(clerkUserId: string) {
  const res = await app.request(
    '/households',
    asParent(clerkUserId, {
      method: 'POST',
      body: JSON.stringify({ name: 'Galili', tz: TZ, currency: 'ILS' }),
    }),
  );
  const { household } = (await res.json()) as { household: { id: string } };
  const joined: { id: string; session: DeviceSession }[] = [];
  for (const first_name of ['Noa', 'Ori']) {
    const c = await app.request(
      `/households/${household.id}/children`,
      asParent(clerkUserId, {
        method: 'POST',
        body: JSON.stringify({ first_name, ui_mode: 'little', pet_name: 'Pip' }),
      }),
    );
    const child = (await c.json()) as { id: string };
    const issued = (await (
      await app.request(
        `/households/${household.id}/children/${child.id}/join-code`,
        asParent(clerkUserId, { method: 'POST' }),
      )
    ).json()) as { code: string };
    const redeemed = await app.request('/join-codes/redeem', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: issued.code, platform: 'android' }),
    });
    joined.push({ id: child.id, session: (await redeemed.json()) as DeviceSession });
  }
  const putChore = (choreId: string, fields: Record<string, unknown>) =>
    app.request(
      `/households/${household.id}/chores/${choreId}`,
      asParent(clerkUserId, {
        method: 'PUT',
        body: JSON.stringify({ fields, updated_at: new Date().toISOString() }),
      }),
    );
  return { householdId: household.id, noa: joined[0]!, ori: joined[1]!, putChore };
}

async function sync(session: DeviceSession, cursor: number, ops: unknown[] = []) {
  const res = await app.request('/sync', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${session.device_token}`,
    },
    body: JSON.stringify({ device_id: session.device_id, cursor, ops }),
  });
  return { status: res.status, body: (await res.json()) as SyncResponse };
}

/** Drains every page; returns all changes and the final cursor. */
async function pullAll(session: DeviceSession, cursor = 0) {
  const changes: SyncResponse['changes'][number][] = [];
  let pages = 0;
  for (;;) {
    const { status, body } = await sync(session, cursor);
    expect(status).toBe(200);
    changes.push(...body.changes);
    cursor = body.cursor;
    pages++;
    if (!body.has_more) break;
  }
  return { changes, cursor, pages };
}

const ofTable = (changes: SyncResponse['changes'], table: string) =>
  changes.filter((c) => c.table === table);

describe('POST /sync pull', () => {
  it('needs a kid device token', async () => {
    const res = await app.request('/sync', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ device_id: uuid7(), cursor: 0, ops: [] }),
    });
    expect(res.status).toBe(401);
  });

  it('returns the child row, assigned chores with assignees and today’s instance, scoped to the token’s child', async () => {
    const { noa, ori, putChore } = await setup('user_pull');
    const shared = uuid7();
    const orisOnly = uuid7();
    expect(
      (await putChore(shared, { title: 'Dishes', kind: 'daily', assignees: [noa.id, ori.id] }))
        .status,
    ).toBe(201);
    expect(
      (await putChore(orisOnly, { title: 'Trash', kind: 'daily', assignees: [ori.id] })).status,
    ).toBe(201);

    const { changes } = await pullAll(noa.session);

    const children = ofTable(changes, 'children');
    expect(children.map((c) => c.row_id)).toEqual([noa.id]);
    expect(children[0]!.row).toMatchObject({ id: noa.id, first_name: 'Noa', ui_mode: 'little' });
    // Nothing about the household's other people or secrets rides along.
    expect(children[0]!.row).not.toHaveProperty('token_hash');

    const chores = ofTable(changes, 'chores');
    expect(new Set(chores.map((c) => c.row_id))).toEqual(new Set([shared]));
    expect(chores.at(-1)!.row).toMatchObject({ id: shared, title: 'Dishes', kind: 'daily' });

    const assignees = ofTable(changes, 'chore_assignees');
    expect(assignees.map((a) => a.row)).toEqual([{ chore_id: shared, child_id: noa.id }]);

    const instances = ofTable(changes, 'chore_instances');
    expect(instances).toHaveLength(1);
    expect(instances[0]!.row).toMatchObject({
      id: instanceId(shared, noa.id, today()),
      chore_id: shared,
      child_id: noa.id,
      chore_date: today(),
      status: 'due',
    });
  });

  it('materializes today lazily on read and does it once', async () => {
    const { noa, putChore } = await setup('user_lazy');
    const choreId = uuid7();
    await putChore(choreId, { title: 'Bed', kind: 'daily', assignees: [noa.id] });

    const first = await pullAll(noa.session);
    expect(ofTable(first.changes, 'chore_instances')).toHaveLength(1);

    const second = await pullAll(noa.session, first.cursor);
    expect(second.changes).toEqual([]);
    expect(second.cursor).toBe(first.cursor);

    const rows = await db.select().from(choreInstances).where(eq(choreInstances.childId, noa.id));
    expect(rows).toHaveLength(1);
  });

  it('does not materialize chores that are not due today or are deleted', async () => {
    const { noa, putChore, householdId } = await setup('user_notdue');
    const once = uuid7();
    const deleted = uuid7();
    await putChore(once, {
      title: 'Later',
      kind: 'once',
      due_date: '2099-01-01',
      assignees: [noa.id],
    });
    await putChore(deleted, { title: 'Gone', kind: 'daily', assignees: [noa.id] });
    await app.request(
      `/households/${householdId}/chores/${deleted}`,
      asParent('user_notdue', {
        method: 'DELETE',
        body: JSON.stringify({ updated_at: new Date().toISOString() }),
      }),
    );
    const { changes } = await pullAll(noa.session);
    expect(ofTable(changes, 'chore_instances')).toEqual([]);
    // The deleted chore still syncs (as deleted) so the device can drop it.
    expect(ofTable(changes, 'chores').at(-1)!.row).toMatchObject({ id: deleted });
    expect(ofTable(changes, 'chores').at(-1)!.row.deleted_at).not.toBeNull();
  });

  it('paginates by seq with a cursor and has_more', async () => {
    const { noa, putChore } = await setup('user_page');
    for (const title of ['A', 'B', 'C', 'D']) {
      await putChore(uuid7(), { title, kind: 'daily', assignees: [noa.id] });
    }
    // child row + 4 chores + 4 assignees + 4 instances = 13 changes at a page size of 3.
    const page1 = await sync(noa.session, 0);
    expect(page1.body.changes).toHaveLength(3);
    expect(page1.body.has_more).toBe(true);
    expect(page1.body.cursor).toBe(page1.body.changes.at(-1)!.seq);

    const page2 = await sync(noa.session, page1.body.cursor);
    expect(page2.body.changes[0]!.seq).toBeGreaterThan(page1.body.cursor);

    const all = await pullAll(noa.session);
    expect(all.pages).toBe(5);
    expect(all.changes).toHaveLength(13);
    const seqs = all.changes.map((c) => c.seq);
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
    expect(new Set(seqs).size).toBe(seqs.length);
    expect(all.cursor).toBe(seqs.at(-1));
  });

  it('only sends instances inside today ±14 days', async () => {
    const { noa, putChore, householdId } = await setup('user_window');
    const choreId = uuid7();
    await putChore(choreId, { title: 'Bed', kind: 'daily', assignees: [noa.id] });
    const far = '2000-01-01';
    await db.insert(choreInstances).values({
      id: instanceId(choreId, noa.id, far),
      choreId,
      childId: noa.id,
      householdId,
      choreDate: far,
      status: 'due',
    });
    const { changes } = await pullAll(noa.session);
    const dates = ofTable(changes, 'chore_instances').map((c) => c.row.chore_date);
    expect(dates).toEqual([today()]);
  });

  it('refuses a device id that is not the token’s', async () => {
    const { noa } = await setup('user_mismatch');
    const res = await app.request('/sync', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${noa.session.device_token}`,
      },
      body: JSON.stringify({ device_id: uuid7(), cursor: 0, ops: [] }),
    });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'device_mismatch' });
  });

  it('rejects ops it does not know yet instead of dropping them', async () => {
    const { noa } = await setup('user_ops');
    const opId = uuid7();
    const { status, body } = await sync(noa.session, 0, [
      { op_id: opId, type: 'complete', payload: {} },
    ]);
    expect(status).toBe(200);
    expect(body.acked).toEqual([]);
    expect(body.rejected).toEqual([{ op_id: opId, reason: 'unknown_op' }]);
  });
});
