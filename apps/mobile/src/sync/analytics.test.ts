import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { instanceId, uuid7, type SyncRequest, type SyncResponse } from '@chores/shared';
import { eq } from 'drizzle-orm';
import { choreAssignees, chores, outbox } from '@/db/schema';
import { openTestDb, openTestDbAt } from '@/db/test-db';
import type { DeviceDb } from '@/db/types';
import { markActivated, markDayComplete, markGroveStage, markOpen } from './analytics';
import { materializeToday } from './engine';
import { cacheFetchedFlags, readFlag } from './flags';
import { tapContext, tapDone, type ChildContext } from './local';
import { syncNow } from './sync';

let db: DeviceDb;
let dir: string | undefined;

beforeEach(async () => {
  db = await openTestDb();
});

afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = undefined;
});

describe('markOpen', () => {
  it('is true the first time this chore date is opened and false after', async () => {
    expect(await markOpen(db, '2026-09-10')).toBe(true);
    expect(await markOpen(db, '2026-09-10')).toBe(false);
    expect(await markOpen(db, '2026-09-10')).toBe(false);
  });

  it('is true again on the next chore date, which is what daily retention counts', async () => {
    await markOpen(db, '2026-09-10');
    expect(await markOpen(db, '2026-09-11')).toBe(true);
  });

  it('does not report an open again when the day boundary moves the date backwards', async () => {
    await markOpen(db, '2026-09-11');
    expect(await markOpen(db, '2026-09-10')).toBe(false);
  });
});

describe('markDayComplete', () => {
  it('is true once per chore date, however often the day is read as complete', async () => {
    expect(await markDayComplete(db, '2026-09-10')).toBe(true);
    expect(await markDayComplete(db, '2026-09-10')).toBe(false);
    expect(await markDayComplete(db, '2026-09-11')).toBe(true);
  });

  it('is independent of the open on the same day', async () => {
    await markOpen(db, '2026-09-10');
    expect(await markDayComplete(db, '2026-09-10')).toBe(true);
    expect(await markOpen(db, '2026-09-10')).toBe(false);
  });
});

describe('markGroveStage', () => {
  it('records the grove a device starts with, and reports only what grows after', async () => {
    expect(await markGroveStage(db, 0)).toBe(false);
    expect(await markGroveStage(db, 1)).toBe(true);
    expect(await markGroveStage(db, 1)).toBe(false);
    expect(await markGroveStage(db, 2)).toBe(true);
  });

  it('says nothing about a grove a rejoined device is only just learning about', async () => {
    expect(await markGroveStage(db, 7)).toBe(false);
    expect(await markGroveStage(db, 7)).toBe(false);
    expect(await markGroveStage(db, 8)).toBe(true);
  });

  it('never reports a shrink: a tree is never taken back (ADR-0011)', async () => {
    await markGroveStage(db, 0);
    await markGroveStage(db, 3);
    expect(await markGroveStage(db, 2)).toBe(false);
    expect(await markGroveStage(db, 3)).toBe(false);
    expect(await markGroveStage(db, 4)).toBe(true);
  });
});

describe('what is remembered', () => {
  it('survives a restart, so a relaunch on the same day is not another open', async () => {
    dir = mkdtempSync(path.join(tmpdir(), 'mibo-'));
    const file = path.join(dir, 'mibo.db');
    const first = await openTestDbAt(file);
    expect(await markOpen(first.db, '2026-09-10')).toBe(true);
    first.close();

    const second = await openTestDbAt(file);
    expect(await markOpen(second.db, '2026-09-10')).toBe(false);
    second.close();
  });
});

describe('markActivated', () => {
  const T = '2026-09-09T10:00:00.000Z';
  const TODAY = '2026-09-09';
  const child: ChildContext = {
    householdId: uuid7(),
    childId: uuid7(),
    deviceId: uuid7(),
    tz: 'Asia/Jerusalem',
    dayBoundaryHour: 0,
  };

  /** A daily chore due today, as a pull would have written it. */
  async function dueChore(target: DeviceDb) {
    const id = uuid7();
    await target.insert(chores).values({
      id,
      household_id: child.householdId,
      title: 'Brush teeth',
      icon: null,
      kind: 'daily',
      weekday_mask: null,
      start_date: null,
      end_date: null,
      due_date: null,
      requires_photo: false,
      version: 1,
      updated_at: T,
      updated_by: uuid7(),
      deleted_at: null,
      field_clocks: {},
    });
    await target.insert(choreAssignees).values({ chore_id: id, child_id: child.childId });
    await materializeToday(target, child.childId, TODAY);
    return { chore_id: id, id: instanceId(id, child.childId, TODAY) };
  }

  /** A tap done, and whether the device would report it as Activation — what the screen does. */
  async function complete(target: DeviceDb): Promise<boolean> {
    await tapDone(target, tapContext(child, new Date(T)), await dueChore(target));
    return markActivated(target);
  }

  const acks = (req: SyncRequest): Promise<SyncResponse> =>
    Promise.resolve({
      acked: req.ops.map((o) => ({ op_id: o.op_id })),
      rejected: [],
      changes: [],
      cursor: 1,
      has_more: false,
    });

  it('is true on this device’s first completion and false on the second', async () => {
    expect(await complete(db)).toBe(true);
    expect(await complete(db)).toBe(false);
  });

  it('fires exactly once for an offline first completion, and not again once the outbox syncs', async () => {
    const fired = [await complete(db)];
    const offline = () => Promise.reject(new Error('offline'));
    await expect(syncNow(db, child, offline)).rejects.toThrow('offline');
    fired.push(await complete(db));

    // The network comes back, and the queued completions reach the server.
    await db.update(outbox).set({ next_attempt_at: new Date(0).toISOString() });
    await syncNow(db, child, acks);
    expect(await db.select().from(outbox).where(eq(outbox.status, 'pending'))).toEqual([]);
    fired.push(await complete(db));

    expect(fired).toEqual([true, false, false]);
  });

  it('survives a restart, so a relaunch is not a second Activation', async () => {
    dir = mkdtempSync(path.join(tmpdir(), 'mibo-'));
    const file = path.join(dir, 'mibo.db');
    const first = await openTestDbAt(file);
    expect(await complete(first.db)).toBe(true);
    first.close();

    const second = await openTestDbAt(file);
    expect(await complete(second.db)).toBe(false);
    second.close();
  });

  it('is its own record, apart from the daily events', async () => {
    await markOpen(db, TODAY);
    await markDayComplete(db, TODAY);
    await markGroveStage(db, 0);
    expect(await complete(db)).toBe(true);
    expect(await markOpen(db, TODAY)).toBe(false);
  });
});

describe('cacheFetchedFlags', () => {
  const now = new Date('2026-09-10T08:00:00.000Z');

  it('caches what parent mode fetched, so kid mode can read it offline', async () => {
    expect(await cacheFetchedFlags(db, { pet_enabled: false, grove_enabled: true }, now)).toEqual([
      'pet_enabled',
      'grove_enabled',
    ]);
    expect(await readFlag(db, 'pet_enabled')).toBe(false);
    expect(await readFlag(db, 'grove_enabled')).toBe(true);
  });

  it('caches the two flags independently, so either bet can be turned off alone', async () => {
    await cacheFetchedFlags(db, { pet_enabled: false, grove_enabled: true }, now);
    await cacheFetchedFlags(db, { pet_enabled: true, grove_enabled: false }, now);
    expect(await readFlag(db, 'pet_enabled')).toBe(true);
    expect(await readFlag(db, 'grove_enabled')).toBe(false);
  });

  it('reads a variant as the experience being on; only an explicit false turns it off', async () => {
    await cacheFetchedFlags(db, { pet_enabled: 'sparkly', grove_enabled: false }, now);
    expect(await readFlag(db, 'pet_enabled')).toBe(true);
    expect(await readFlag(db, 'grove_enabled')).toBe(false);
  });

  it('leaves a flag the project does not define at what the cache last knew', async () => {
    await cacheFetchedFlags(db, { pet_enabled: false }, now);
    expect(await cacheFetchedFlags(db, { grove_enabled: true }, now)).toEqual(['grove_enabled']);
    expect(await readFlag(db, 'pet_enabled')).toBe(false);
  });

  it('caches nothing it was not given, so an empty answer changes nothing', async () => {
    await cacheFetchedFlags(db, { pet_enabled: false }, now);
    expect(await cacheFetchedFlags(db, {}, now)).toEqual([]);
    expect(await readFlag(db, 'pet_enabled')).toBe(false);
  });
});
