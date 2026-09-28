import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { uuid7, type SyncResponse } from '@chores/shared';
import { openTestDb, openTestDbAt } from '@/db/test-db';
import { choreAssignees, chores } from '@/db/schema';
import type { DeviceDb } from '@/db/types';
import { materializeToday, todayList } from './engine';
import { greetingFor, markGreetingSeen } from './greeting';
import { tapContext, tapDone, type ChildContext } from './local';
import { syncNow } from './sync';

const childId = uuid7();
const householdId = uuid7();
const parentId = uuid7();
const T = '2026-09-09T10:00:00.000Z';
const TODAY = '2026-09-09';
const TOMORROW = '2026-09-10';

const child: ChildContext = {
  householdId,
  childId,
  deviceId: uuid7(),
  tz: 'Asia/Jerusalem',
  dayBoundaryHour: 0,
};

let db: DeviceDb;
let dir: string | null = null;

beforeEach(async () => {
  db = await openTestDb();
});

afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = null;
});

async function seedChore(target: DeviceDb, title: string) {
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
}

async function today(target: DeviceDb, date = TODAY) {
  await materializeToday(target, childId, date);
  return todayList(target, childId, date);
}

describe('greetingFor', () => {
  it('greets a fresh device and points at the first due row', async () => {
    await seedChore(db, 'Make your bed');
    await seedChore(db, 'Brush teeth');
    const items = await today(db);

    const greeting = await greetingFor(db, items);

    expect(greeting).toEqual({ pointAt: items[0]!.id });
    expect(items[0]!.title).toBe('Brush teeth');
  });

  it('points past a row that is already done, at the first one still due', async () => {
    await seedChore(db, 'Brush teeth');
    await seedChore(db, 'Make your bed');
    const [first] = await today(db);
    await tapDone(db, tapContext(child, new Date(T)), first!);
    const items = await today(db);

    expect(await greetingFor(db, items)).toEqual({ pointAt: items[1]!.id });
  });

  it('greets without pointing when there is nothing due today', async () => {
    expect(await greetingFor(db, await today(db))).toEqual({ pointAt: null });
  });

  it('is gone once seen, and seeing it twice changes nothing', async () => {
    await seedChore(db, 'Brush teeth');
    await markGreetingSeen(db, new Date(T));
    await markGreetingSeen(db, new Date(T));

    expect(await greetingFor(db, await today(db))).toBeNull();
  });
});

describe('what is remembered', () => {
  it('survives a restart', async () => {
    dir = mkdtempSync(path.join(tmpdir(), 'mibo-'));
    const file = path.join(dir, 'mibo.db');
    const first = await openTestDbAt(file);
    await markGreetingSeen(first.db, new Date(T));
    first.close();

    const second = await openTestDbAt(file);
    expect(await greetingFor(second.db, [])).toBeNull();
    second.close();
  });

  it('survives a sync, which never carries it: it belongs to the device, not the child', async () => {
    await markGreetingSeen(db, new Date(T));
    const reply: SyncResponse = {
      acked: [],
      rejected: [],
      changes: [],
      cursor: 0,
      has_more: false,
    };
    await syncNow(db, child, () => Promise.resolve(reply));

    expect(await greetingFor(db, await today(db))).toBeNull();
  });

  it('survives the next Chore Date', async () => {
    await seedChore(db, 'Brush teeth');
    await markGreetingSeen(db, new Date(T));

    expect(await greetingFor(db, await today(db, TOMORROW))).toBeNull();
  });
});
