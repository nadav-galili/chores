import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  bonusId,
  clawbackId,
  COINS_PER_CHORE,
  DAY_COMPLETE_BONUS,
  earnId,
  instanceId,
  redeemEntryId,
  redemptionRefundId,
  xpId,
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
  ledgerEntries,
  outbox,
  redemptions,
  rewards,
  syncState,
} from '@/db/schema';
import { materializeToday, todayList } from './engine';
import { balanceOf, tapContext, tapDone, type ChildContext } from './local';
import { xpTotalOf } from './pet';
import { backoffMs, pendingOps } from './outbox';
import { askForReward, cancelRedemption } from './redeem';
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

/** One catalog row, as a pull would have written it. */
async function seedReward(target: DeviceDb, cost_coins = COINS_PER_CHORE + DAY_COMPLETE_BONUS) {
  const id = uuid7();
  await target.insert(rewards).values({
    id,
    household_id: householdId,
    builtin_key: 'snack',
    title: null,
    icon: '🍿',
    cost_coins,
    is_builtin: true,
    active: true,
    sort: 0,
    updated_at: T,
    deleted_at: null,
  });
  return { id, cost_coins };
}

/** The coins a Day Complete pays, with the op that earned them already acked and gone. */
async function seedEarnedCoins(target: DeviceDb) {
  const instance = await seedChore(target);
  await tapDone(target, tapContext(child, new Date(T)), instance);
  const acks = fakeServer((req) => empty({ acked: req.ops.map((o) => ({ op_id: o.op_id })) }));
  await syncNow(target, child, acks.call);
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

  it('applies a parent’s rejection pulled from the server: the coins drop and the chore is a redo', async () => {
    const instance = await seedChore(db);
    await tapDone(db, tapContext(child, new Date(T)), instance);
    const [done] = await db.select().from(completions);
    expect(await balanceOf(db, childId)).toBe(COINS_PER_CHORE + DAY_COMPLETE_BONUS);

    // The server acked the tap, then a parent rejected it: the completion stops counting, the
    // instance comes back as a redo, and the clawbacks reverse the earn and the day bonus. XP
    // mirrors every clawback 1:1, so the pet loses exactly what the tap gave it.
    const clawback = (id: string, coins: number) => ({
      id: clawbackId(id),
      household_id: householdId,
      child_id: childId,
      kind: 'clawback',
      coins,
      money_amount: null,
      ref_type: 'ledger_entry',
      ref_id: id,
      created_at: T,
      created_by: parentId,
    });
    const rows = [
      { table: 'completions', row_id: done!.id, row: { ...done!, status: 'rejected' } },
      {
        table: 'chore_instances',
        row_id: instance.id,
        row: {
          ...(await db.select().from(choreInstances).where(eq(choreInstances.id, instance.id)))[0]!,
          status: 'redo',
        },
      },
      {
        table: 'ledger_entries',
        row_id: clawbackId(earnId(done!.id)),
        row: clawback(earnId(done!.id), -COINS_PER_CHORE),
      },
      {
        table: 'ledger_entries',
        row_id: clawbackId(bonusId(childId, TODAY)),
        row: clawback(bonusId(childId, TODAY), -DAY_COMPLETE_BONUS),
      },
      ...[
        [earnId(done!.id), -COINS_PER_CHORE] as const,
        [bonusId(childId, TODAY), -DAY_COMPLETE_BONUS] as const,
      ].map(([id, coins]) => ({
        table: 'xp_events',
        row_id: xpId(clawbackId(id)),
        row: {
          id: xpId(clawbackId(id)),
          child_id: childId,
          xp: coins,
          ref_entry_id: clawbackId(id),
          created_at: T,
        },
      })),
      {
        table: 'day_summaries',
        // day_summaries has no id column, so the server logs the change under the child (see the
        // 0004 migration); the device matches on the row's own primary key either way.
        row_id: childId,
        row: {
          child_id: childId,
          chore_date: TODAY,
          due_count: 1,
          done_count: 0,
          complete: false,
          streak_after: 0,
        },
      },
    ];
    const server = fakeServer((req) =>
      empty({
        acked: req.ops.map((o) => ({ op_id: o.op_id })),
        changes: rows.map((r, i) => ({ seq: i + 1, op: 'update' as const, ...r })),
        cursor: rows.length,
      }),
    );
    await syncNow(db, child, server.call);

    expect(await balanceOf(db, childId)).toBe(0);
    const [stored] = await db.select().from(completions);
    expect(stored!.status).toBe('rejected');
    const [item] = await todayList(db, childId, TODAY);
    expect(item!.status).toBe('redo');
    expect(await xpTotalOf(db, childId)).toBe(0);
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

  it('undoes a refused request for a reward: no redemption, no redeem entry, the coins come back', async () => {
    await seedEarnedCoins(db);
    const reward = await seedReward(db);
    const spent = await balanceOf(db, childId);
    expect(spent).toBe(COINS_PER_CHORE + DAY_COMPLETE_BONUS);

    const asked = await askForReward(db, tapContext(child, new Date(T)), reward);
    const redemption_id = asked.ok ? asked.redemption_id : '';
    expect(await balanceOf(db, childId)).toBe(0);

    // A parent's Rejection took coins this device had not pulled, so the server refuses.
    const server = fakeServer((req) =>
      empty({
        rejected: req.ops.map((o) => ({ op_id: o.op_id, reason: 'insufficient_coins' as const })),
      }),
    );
    await syncNow(db, child, server.call);

    expect(await db.select().from(redemptions)).toEqual([]);
    expect(
      await db
        .select()
        .from(ledgerEntries)
        .where(eq(ledgerEntries.id, redeemEntryId(redemption_id))),
    ).toEqual([]);
    expect(await balanceOf(db, childId)).toBe(spent);

    const [row] = await db.select().from(outbox);
    expect(row).toMatchObject({ status: 'rejected', reason: 'insufficient_coins' });
    // And it is never sent again.
    await syncNow(db, child, server.call);
    expect(server.sent[1]!.ops).toEqual([]);
  });

  it('undoes a refused cancel: the refund goes and the request stands again', async () => {
    await seedEarnedCoins(db);
    const reward = await seedReward(db);
    const ctx = tapContext(child, new Date(T));
    const asked = await askForReward(db, ctx, reward);
    const redemption_id = asked.ok ? asked.redemption_id : '';
    // The request is the server's now; only the cancel that follows is refused.
    await syncNow(
      db,
      child,
      fakeServer((req) => empty({ acked: req.ops.map((o) => ({ op_id: o.op_id })) })).call,
    );

    await cancelRedemption(db, ctx, redemption_id);
    expect(await balanceOf(db, childId)).toBe(COINS_PER_CHORE + DAY_COMPLETE_BONUS);

    const server = fakeServer((req) =>
      empty({
        rejected: req.ops.map((o) => ({ op_id: o.op_id, reason: 'already_decided' as const })),
      }),
    );
    await syncNow(db, child, server.call);

    const [row] = await db.select().from(redemptions);
    expect(row).toMatchObject({ id: redemption_id, status: 'requested', decided_at: null });
    expect(
      await db
        .select()
        .from(ledgerEntries)
        .where(eq(ledgerEntries.id, redemptionRefundId(redemption_id))),
    ).toEqual([]);
    // The coins are gone again: the parent is deciding a request that still stands.
    expect(await balanceOf(db, childId)).toBe(0);
  });

  it('carries the rollback across a restart mid-drain: the outbox and the rows agree either way', async () => {
    dir = mkdtempSync(path.join(tmpdir(), 'mibo-'));
    const file = path.join(dir, 'mibo.db');
    const later = () => new Date(Date.now() + 60_000);

    const first = await openTestDbAt(file);
    await seedEarnedCoins(first.db);
    const reward = await seedReward(first.db);
    const earned = await balanceOf(first.db, childId);

    // The request never reaches a verdict: the phone dies with the rows and the op both in place.
    const asked = await askForReward(first.db, tapContext(child, new Date(T)), reward);
    const first_id = asked.ok ? asked.redemption_id : '';
    await expect(
      syncNow(first.db, child, () => Promise.reject(new Error('offline'))),
    ).rejects.toThrow();
    first.close();

    const second = await openTestDbAt(file);
    expect((await pendingOps(second.db, later())).map((o) => o.type)).toEqual([
      'request_redemption',
    ]);
    expect(await second.db.select().from(redemptions)).toHaveLength(1);
    expect(await balanceOf(second.db, childId)).toBe(0);

    // The backoff from the dead request has passed.
    await second.db
      .update(outbox)
      .set({ next_attempt_at: new Date(Date.now() - 1_000).toISOString() })
      .where(eq(outbox.status, 'pending'));

    // This time the refusal lands, and the phone dies on the page that follows it. The rollback
    // is committed with the refusal, so the restart finds neither half of it missing.
    const refuse = (req: SyncRequest): SyncResponse =>
      empty({
        rejected: req.ops.map((o) => ({ op_id: o.op_id, reason: 'insufficient_coins' as const })),
        has_more: true,
      });
    let calls = 0;
    await expect(
      syncNow(second.db, child, (req) => {
        if (calls++) return Promise.reject(new Error('offline'));
        return Promise.resolve(refuse(req));
      }),
    ).rejects.toThrow();
    second.close();

    const third = await openTestDbAt(file);
    expect(await third.db.select().from(redemptions)).toEqual([]);
    expect(
      await third.db
        .select()
        .from(ledgerEntries)
        .where(eq(ledgerEntries.id, redeemEntryId(first_id))),
    ).toEqual([]);
    expect(await balanceOf(third.db, childId)).toBe(earned);
    expect(await pendingOps(third.db, later())).toEqual([]);
    const [refused] = await third.db.select().from(outbox).where(eq(outbox.status, 'rejected'));
    expect(refused).toMatchObject({ type: 'request_redemption', reason: 'insufficient_coins' });
    third.close();
  });
});
