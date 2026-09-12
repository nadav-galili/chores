import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import {
  builtinRewardId,
  BUILTIN_REWARDS,
  instanceId,
  uuid7,
  type SyncChange,
  type SyncResponse,
} from '@chores/shared';
import { openTestDb } from '@/db/test-db';
import type { DeviceDb } from '@/db/types';
import {
  children,
  choreAssignees,
  choreInstances,
  chores,
  redemptions,
  rewards,
} from '@/db/schema';
import { applyPull, materializeToday, readCursor, todayList } from './engine';

let db: DeviceDb;
const childId = uuid7();
const householdId = uuid7();
const parentId = uuid7();
const T = '2026-09-09T10:00:00.000Z';
const TODAY = '2026-09-09';

let seq = 0;
const change = (
  table: string,
  op: SyncChange['op'],
  row: Record<string, unknown>,
  row_id = row.id as string,
): SyncChange => ({ seq: ++seq, table, row_id, op, row });

const page = (changes: SyncChange[], has_more = false): SyncResponse => ({
  acked: [],
  rejected: [],
  changes,
  cursor: changes.at(-1)?.seq ?? 0,
  has_more,
});

const childRow = {
  id: childId,
  household_id: householdId,
  first_name: 'Noa',
  ui_mode: 'little',
  pet_name: 'Pip',
  reminder_time: null,
  read_only_after: null,
  sort: 0,
  created_at: T,
};

const choreRow = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  household_id: householdId,
  title: 'Dishes',
  icon: '🍽️',
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
  field_clocks: { title: T },
  ...extra,
});

beforeEach(async () => {
  db = await openTestDb();
  seq = 0;
});

describe('applyPull', () => {
  it('upserts rows of every table in the page and persists the cursor', async () => {
    const choreId = uuid7();
    await applyPull(
      db,
      page([
        change('children', 'insert', childRow),
        change('chores', 'insert', choreRow(choreId)),
        change('chore_assignees', 'insert', { chore_id: choreId, child_id: childId }, choreId),
        change('chore_instances', 'insert', {
          id: instanceId(choreId, childId, TODAY),
          chore_id: choreId,
          child_id: childId,
          household_id: householdId,
          chore_date: TODAY,
          status: 'due',
        }),
      ]),
    );
    expect(await db.select().from(children)).toMatchObject([
      { id: childId, ui_mode: 'little', read_only_after: null },
    ]);
    expect(await db.select().from(chores)).toMatchObject([
      { id: choreId, title: 'Dishes', requires_photo: false, field_clocks: { title: T } },
    ]);
    expect(await db.select().from(choreAssignees)).toEqual([
      { chore_id: choreId, child_id: childId },
    ]);
    expect(await db.select().from(choreInstances)).toMatchObject([{ chore_date: TODAY }]);
    expect(await readCursor(db)).toBe(4);
  });

  it('stores a sibling read_only_after mirror without using it to filter the grove', async () => {
    const siblingId = uuid7();
    const readOnlyAfter = '2026-09-23T12:00:00.000Z';
    await applyPull(
      db,
      page([
        change('children', 'insert', childRow),
        change('children', 'insert', {
          ...childRow,
          id: siblingId,
          first_name: 'Ori',
          read_only_after: readOnlyAfter,
        }),
      ]),
    );

    expect(await db.select().from(children)).toMatchObject([
      { id: childId, read_only_after: null },
      { id: siblingId, read_only_after: readOnlyAfter },
    ]);
  });

  it('starts at cursor 0 and moves it only forward', async () => {
    expect(await readCursor(db)).toBe(0);
    await applyPull(db, page([change('children', 'insert', childRow)]));
    expect(await readCursor(db)).toBe(1);
    await applyPull(db, { ...page([]), cursor: 0 });
    expect(await readCursor(db)).toBe(1);
  });

  it('applies an update over an earlier insert, the last change in the page winning', async () => {
    const choreId = uuid7();
    await applyPull(db, page([change('chores', 'insert', choreRow(choreId))]));
    await applyPull(
      db,
      page([
        change('chores', 'update', choreRow(choreId, { title: 'Plates', version: 2 })),
        change('chores', 'update', choreRow(choreId, { title: 'Bowls', version: 3 })),
      ]),
    );
    expect(await db.select().from(chores)).toMatchObject([{ title: 'Bowls', version: 3 }]);
  });

  it('removes a row on delete, so an unassigned chore drops out', async () => {
    const choreId = uuid7();
    await applyPull(
      db,
      page([
        change('chores', 'insert', choreRow(choreId)),
        change('chore_assignees', 'insert', { chore_id: choreId, child_id: childId }, choreId),
      ]),
    );
    await applyPull(
      db,
      page([
        change('chore_assignees', 'delete', { chore_id: choreId, child_id: childId }, choreId),
      ]),
    );
    expect(await db.select().from(choreAssignees)).toEqual([]);
  });

  it('ignores columns and tables it does not know, so a newer server does not break it', async () => {
    await applyPull(
      db,
      page([
        change('children', 'insert', { ...childRow, shoe_size: 33 }),
        change('households', 'insert', { id: householdId, name: 'x' }),
      ]),
    );
    expect(await db.select().from(children)).toHaveLength(1);
    expect(await readCursor(db)).toBe(2);
  });

  it('is atomic: a bad row leaves the cursor and the page unapplied', async () => {
    const choreId = uuid7();
    await expect(
      applyPull(
        db,
        page([
          change('chores', 'insert', choreRow(choreId)),
          change('chores', 'insert', { id: uuid7() }), // NOT NULL violation
        ]),
      ),
    ).rejects.toThrow();
    expect(await db.select().from(chores)).toEqual([]);
    expect(await readCursor(db)).toBe(0);
  });
});

describe('materializeToday', () => {
  const setupChores = async () => {
    const daily = uuid7();
    const weekend = uuid7();
    const gone = uuid7();
    const someoneElses = uuid7();
    await applyPull(
      db,
      page([
        change('children', 'insert', childRow),
        change('chores', 'insert', choreRow(daily)),
        change('chore_assignees', 'insert', { chore_id: daily, child_id: childId }, daily),
        // Sat+Sun only; 2026-09-09 is a Wednesday.
        change(
          'chores',
          'insert',
          choreRow(weekend, { kind: 'weekdays', weekday_mask: 0b110_0000 }),
        ),
        change('chore_assignees', 'insert', { chore_id: weekend, child_id: childId }, weekend),
        change('chores', 'insert', choreRow(gone, { deleted_at: T })),
        change('chore_assignees', 'insert', { chore_id: gone, child_id: childId }, gone),
        change('chores', 'insert', choreRow(someoneElses)),
      ]),
    );
    return { daily, weekend, gone, someoneElses };
  };

  it('creates today’s due instances from local chores with the shared function', async () => {
    const { daily } = await setupChores();
    await materializeToday(db, childId, TODAY);
    const rows = await db.select().from(choreInstances);
    expect(rows).toEqual([
      {
        id: instanceId(daily, childId, TODAY),
        chore_id: daily,
        child_id: childId,
        household_id: householdId,
        chore_date: TODAY,
        status: 'due',
      },
    ]);
  });

  it('is a no-op the second time and never resets a status the server already moved', async () => {
    const { daily } = await setupChores();
    await materializeToday(db, childId, TODAY);
    const id = instanceId(daily, childId, TODAY);
    await db.update(choreInstances).set({ status: 'done' }).where(eq(choreInstances.id, id));
    await materializeToday(db, childId, TODAY);
    expect(await db.select().from(choreInstances)).toMatchObject([{ id, status: 'done' }]);
  });

  it('a server row with the same deterministic id merges instead of duplicating', async () => {
    const { daily } = await setupChores();
    await materializeToday(db, childId, TODAY);
    await applyPull(
      db,
      page([
        change('chore_instances', 'insert', {
          id: instanceId(daily, childId, TODAY),
          chore_id: daily,
          child_id: childId,
          household_id: householdId,
          chore_date: TODAY,
          status: 'due',
        }),
      ]),
    );
    expect(await db.select().from(choreInstances)).toHaveLength(1);
  });
});

describe('todayList', () => {
  it('lists today’s instances with their chore, in title order, skipping deleted or unassigned chores', async () => {
    const a = uuid7();
    const b = uuid7();
    const gone = uuid7();
    const unassigned = uuid7();
    const inst = (chore_id: string, chore_date = TODAY) => ({
      id: instanceId(chore_id, childId, chore_date),
      chore_id,
      child_id: childId,
      household_id: householdId,
      chore_date,
      status: 'due',
    });
    await applyPull(
      db,
      page([
        change('children', 'insert', childRow),
        change('chores', 'insert', choreRow(a, { title: 'Zebra', icon: '🦓' })),
        change('chore_assignees', 'insert', { chore_id: a, child_id: childId }, a),
        change('chores', 'insert', choreRow(b, { title: 'Apple' })),
        change('chore_assignees', 'insert', { chore_id: b, child_id: childId }, b),
        change('chores', 'insert', choreRow(gone, { title: 'Gone', deleted_at: T })),
        change('chore_assignees', 'insert', { chore_id: gone, child_id: childId }, gone),
        change('chores', 'insert', choreRow(unassigned, { title: 'Not mine' })),
        change('chore_instances', 'insert', inst(a)),
        change('chore_instances', 'insert', inst(b)),
        change('chore_instances', 'insert', inst(gone)),
        change('chore_instances', 'insert', inst(unassigned)),
        change('chore_instances', 'insert', inst(a, '2026-09-08')),
      ]),
    );
    const list = await todayList(db, childId, TODAY);
    expect(list).toEqual([
      { id: instanceId(b, childId, TODAY), chore_id: b, title: 'Apple', icon: '🍽️', status: 'due' },
      { id: instanceId(a, childId, TODAY), chore_id: a, title: 'Zebra', icon: '🦓', status: 'due' },
    ]);
  });
});

describe('the reward shop', () => {
  const rewardRow = (key: 'snack' | 'screen_time' | 'friday_dinner', extra = {}) => {
    const builtin = BUILTIN_REWARDS.find((r) => r.builtin_key === key)!;
    return {
      id: builtinRewardId(householdId, key),
      household_id: householdId,
      builtin_key: key,
      title: null,
      icon: builtin.icon,
      cost_coins: builtin.cost_coins,
      is_builtin: true,
      active: true,
      sort: builtin.sort,
      updated_at: T,
      deleted_at: null,
      ...extra,
    };
  };

  it('lands the household catalog with its keys and no titles', async () => {
    await applyPull(
      db,
      page(BUILTIN_REWARDS.map((r) => change('rewards', 'insert', rewardRow(r.builtin_key)))),
    );
    const rows = (await db.select().from(rewards)).sort((a, b) => a.sort - b.sort);
    expect(rows.map((r) => [r.builtin_key, r.cost_coins, r.title])).toEqual([
      ['snack', 50, null],
      ['screen_time', 150, null],
      ['friday_dinner', 400, null],
    ]);
    expect(rows.every((r) => r.household_id === householdId)).toBe(true);
  });

  it('hides a built-in the parent turned off, without losing the row', async () => {
    await applyPull(db, page([change('rewards', 'insert', rewardRow('snack'))]));
    await applyPull(db, page([change('rewards', 'update', rewardRow('snack', { active: false }))]));
    expect(await db.select().from(rewards)).toMatchObject([
      { builtin_key: 'snack', active: false },
    ]);
  });

  it('lands a redemption, which is this child’s own and carries its cost', async () => {
    const id = uuid7();
    await applyPull(
      db,
      page([
        change('redemptions', 'insert', {
          id,
          reward_id: builtinRewardId(householdId, 'snack'),
          child_id: childId,
          household_id: householdId,
          cost_coins: 50,
          status: 'requested',
          requested_at: T,
          decided_at: null,
          decided_by: null,
        }),
      ]),
    );
    expect(await db.select().from(redemptions)).toMatchObject([
      { id, child_id: childId, cost_coins: 50, status: 'requested' },
    ]);
  });
});
