import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  COINS_PER_CHORE,
  instanceId,
  uuid7,
  type SyncRequest,
  type SyncResponse,
} from '@chores/shared';
import { openTestDb, openTestDbAt } from '@/db/test-db';
import type { DeviceDb } from '@/db/types';
import {
  choreAssignees,
  choreInstances,
  chores,
  completions,
  outbox,
  syncState,
} from '@/db/schema';
import { materializeToday } from './engine';
import { balanceOf, tapContext, tapDone, type ChildContext } from './local';
import { backoffMs, pendingOps } from './outbox';
import { syncNow } from './sync';

const childId = uuid7();
const householdId = uuid7();
const deviceId = uuid7();
const parentId = uuid7();
const T = '2026-09-09T10:00:00.000Z';
const TODAY = '2026-09-09';

const child: ChildContext = {
  householdId,
  childId,
  deviceId,
  tz: 'Asia/Jerusalem',
  dayBoundaryHour: 0,
};

const empty = (over: Partial<SyncResponse> = {}): SyncResponse => ({
  acked: [],
  rejected: [],
  changes: [],
  cursor: 0,
  has_more: false,
  ...over,
});

/** Records what the device sent and answers with whatever the test queued. */
function fakeServer(...replies: ((req: SyncRequest) => SyncResponse)[]) {
  const sent: SyncRequest[] = [];
  let i = 0;
  const call = (req: SyncRequest) => {
    sent.push(req);
    const reply = replies[Math.min(i++, replies.length - 1)] ?? (() => empty());
    return Promise.resolve(reply(req));
  };
  return { call, sent };
}

let db: DeviceDb;
let dir: string | null = null;

async function seedChore(target: DeviceDb, title = 'Dishes') {
  const id = uuid7();
  await target.insert(chores).values({
    id,
    household_id: householdId,
    title,
    icon: null,
    kind: 'daily',
    weekday_mask: null,
    start_date: null,
    end_date: null,
    due_date: null,
    requires_photo: false,
    version: 1,
    updated_at: T,
    updated_by: parentId,
    deleted_at: null,
    field_clocks: {},
  });
  await target.insert(choreAssignees).values({ chore_id: id, child_id: childId });
  await materializeToday(target, childId, TODAY);
  return { chore_id: id, id: instanceId(id, childId, TODAY) };
}

beforeEach(async () => {
  db = await openTestDb();
});

afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = null;
});

describe('syncNow', () => {
  it('sends the queued ops with the cursor and drops the ones the server acks', async () => {
    const instance = await seedChore(db);
    await tapDone(db, tapContext(child, new Date(T)), instance);
    const [queued] = await db.select().from(outbox);

    const server = fakeServer((req) => empty({ acked: req.ops.map((o) => ({ op_id: o.op_id })) }));
    await syncNow(db, child, server.call);

    expect(server.sent[0]!.device_id).toBe(deviceId);
    expect(server.sent[0]!.cursor).toBe(0);
    expect(server.sent[0]!.ops).toEqual([
      { op_id: queued!.op_id, type: 'complete', payload: queued!.payload },
    ]);
    expect(await db.select().from(outbox)).toEqual([]);
    // The coins the tap paid stay: an ack means the server wrote the same rows.
    expect(await balanceOf(db, childId)).toBeGreaterThan(0);
  });

  it('keeps a refused op out of the queue, with its reason, and undoes what it wrote', async () => {
    const instance = await seedChore(db);
    await tapDone(db, tapContext(child, new Date(T)), instance);

    const server = fakeServer((req) =>
      empty({
        rejected: req.ops.map((o) => ({ op_id: o.op_id, reason: 'unknown_chore' as const })),
      }),
    );
    await syncNow(db, child, server.call);

    const [row] = await db.select().from(outbox);
    expect(row).toMatchObject({ status: 'rejected', reason: 'unknown_chore' });
    // The completion row is never deleted; it just stops counting.
    const [stored] = await db.select().from(completions);
    expect(stored!.status).toBe('undone');
    expect(await balanceOf(db, childId)).toBe(0);
    const [local] = await db
      .select()
      .from(choreInstances)
      .where(eq(choreInstances.id, instance.id));
    expect(local!.status).toBe('due');

    // And it is never sent again.
    await syncNow(db, child, server.call);
    expect(server.sent[1]!.ops).toEqual([]);
  });

  it('returns the instance to due when the server filed the completion under another date', async () => {
    const instance = await seedChore(db);
    await tapDone(db, tapContext(child, new Date(T)), instance);

    const [queued] = await db.select().from(completions);
    // The server accepted the tap but filed it under the date it computed, and sends that row back.
    const server = fakeServer((req) =>
      empty({
        acked: req.ops.map((o) => ({ op_id: o.op_id, date_adjusted: true })),
        changes: [
          {
            seq: 1,
            table: 'completions',
            row_id: queued!.id,
            op: 'update' as const,
            row: { ...queued!, chore_date: '2026-08-20', instance_id: uuid7() },
          },
        ],
        cursor: 1,
      }),
    );
    await syncNow(db, child, server.call);

    expect(await db.select().from(outbox)).toEqual([]);
    const [local] = await db
      .select()
      .from(choreInstances)
      .where(eq(choreInstances.id, instance.id));
    expect(local!.status).toBe('due');
    const [stored] = await db.select().from(completions);
    expect(stored!.chore_date).toBe('2026-08-20');
    // The chore was still done, so it still earns; today is no longer complete, so the day bonus
    // goes back.
    expect(await balanceOf(db, childId)).toBe(COINS_PER_CHORE);
  });

  it('leaves ops queued and backs off when the request never lands', async () => {
    const instance = await seedChore(db);
    await tapDone(db, tapContext(child, new Date(T)), instance);

    const dead = () => Promise.reject(new Error('offline'));
    await expect(syncNow(db, child, dead)).rejects.toThrow('offline');

    const [row] = await db.select().from(outbox);
    expect(row).toMatchObject({ status: 'pending', attempts: 1 });
    expect(new Date(row!.next_attempt_at).getTime()).toBeGreaterThan(Date.now());
    // The tap still counts locally while the op waits.
    expect(await balanceOf(db, childId)).toBeGreaterThan(0);

    // Nothing is sent again until the backoff has passed.
    const server = fakeServer(() => empty());
    await syncNow(db, child, server.call);
    expect(server.sent[0]!.ops).toEqual([]);

    await db
      .update(outbox)
      .set({ next_attempt_at: new Date(Date.now() - 1000).toISOString() })
      .where(eq(outbox.op_id, row!.op_id));
    const alive = fakeServer((req) => empty({ acked: req.ops.map((o) => ({ op_id: o.op_id })) }));
    await syncNow(db, child, alive.call);
    expect(alive.sent[0]!.ops).toHaveLength(1);
    expect(await db.select().from(outbox)).toEqual([]);
  });

  it('backs off further with every failed attempt, up to a ceiling', () => {
    expect(backoffMs(1)).toBe(2_000);
    expect(backoffMs(2)).toBe(4_000);
    expect(backoffMs(3)).toBe(8_000);
    expect(backoffMs(99)).toBe(5 * 60_000);
  });

  it('keeps pulling while the server has more pages', async () => {
    const server = fakeServer(
      () => empty({ cursor: 7, has_more: true }),
      () => empty({ cursor: 9, has_more: false }),
    );
    await syncNow(db, child, server.call);
    expect(server.sent.map((r) => r.cursor)).toEqual([0, 7]);
    const [state] = await db.select().from(syncState);
    expect(state!.cursor).toBe(9);
  });

  it('carries the queue across a restart: nothing about it lives in memory', async () => {
    dir = mkdtempSync(path.join(tmpdir(), 'mibo-'));
    const file = path.join(dir, 'mibo.db');

    const first = await openTestDbAt(file);
    const instance = await seedChore(first.db);
    await tapDone(first.db, tapContext(child, new Date(T)), instance);
    await expect(
      syncNow(first.db, child, () => Promise.reject(new Error('offline'))),
    ).rejects.toThrow();
    first.close();

    const second = await openTestDbAt(file);
    const queued = await pendingOps(second.db, new Date(Date.now() + 60_000));
    expect(queued).toHaveLength(1);
    expect(queued[0]!.type).toBe('complete');
    expect(await balanceOf(second.db, childId)).toBe(COINS_PER_CHORE + 20);
    second.close();
  });
});
