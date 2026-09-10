import { beforeEach, describe, expect, it } from 'vitest';
import { growthId, uuid7, type IsoDate } from '@chores/shared';
import { openTestDb } from '@/db/test-db';
import type { DeviceDb } from '@/db/types';
import { children, growthEntries } from '@/db/schema';
import { GROVE_ENABLED, cacheFlag, readFlag } from './flags';
import { showGrove } from './grove';

let db: DeviceDb;
const householdId = uuid7();
const noa = uuid7();
const ori = uuid7();
const T = '2026-09-09T10:00:00.000Z';

const seedChild = (id: string, first_name: string, sort: number) =>
  db.insert(children).values({
    id,
    household_id: householdId,
    first_name,
    ui_mode: 'little',
    pet_name: 'Pip',
    reminder_time: null,
    sort,
    created_at: T,
  });

/** A day this child was Day Complete, written the way both the tap and the pull write it. */
const plant = (childId: string, chore_date: IsoDate) =>
  db
    .insert(growthEntries)
    .values({
      id: growthId(childId, chore_date),
      household_id: householdId,
      child_id: childId,
      chore_date,
      created_at: T,
    })
    .onConflictDoNothing();

beforeEach(async () => {
  db = await openTestDb();
  await seedChild(noa, 'Noa', 0);
});

describe('showGrove', () => {
  it('is a bare tree for a child who has not completed a day yet', async () => {
    const grove = await showGrove(db, noa);
    expect(grove.enabled).toBe(true);
    expect(grove.ownTree.stage).toBe(0);
    expect(grove.trees).toEqual([{ childId: noa, firstName: 'Noa', stage: 0, isSelf: true }]);
  });

  it('grows one stage per day complete', async () => {
    await plant(noa, '2026-09-07');
    await plant(noa, '2026-09-08');
    expect((await showGrove(db, noa)).ownTree.stage).toBe(2);
  });

  it('counts a replayed day once, because the id is deterministic', async () => {
    await plant(noa, '2026-09-08');
    await plant(noa, '2026-09-08');
    expect((await showGrove(db, noa)).ownTree.stage).toBe(1);
  });

  it('renders one tree per child in the household, own tree first and marked as its own', async () => {
    await seedChild(ori, 'Ori', 1);
    await plant(noa, '2026-09-08');
    await plant(ori, '2026-09-07');
    await plant(ori, '2026-09-08');

    const grove = await showGrove(db, ori);
    expect(grove.trees).toEqual([
      { childId: ori, firstName: 'Ori', stage: 2, isSelf: true },
      { childId: noa, firstName: 'Noa', stage: 1, isSelf: false },
    ]);
    expect(grove.ownTree.stage).toBe(2);
  });

  it('stands a tree up for a child whose own row has not been pulled yet', async () => {
    const grove = await showGrove(db, ori);
    expect(grove.trees).toEqual([
      { childId: ori, firstName: null, stage: 0, isSelf: true },
      { childId: noa, firstName: 'Noa', stage: 0, isSelf: false },
    ]);
  });

  it('cannot lose a tree, because a growth entry is never reversed', async () => {
    await plant(noa, '2026-09-07');
    await plant(noa, '2026-09-08');
    expect((await showGrove(db, noa)).ownTree.stage).toBe(2);

    // A rejection syncing in claws back coins, XP and the streak. There is no clawback
    // counterpart for growth (ADR-0011), so the rows it would have to remove do not move, and
    // the stage — always COUNT(*), never stored — is the same two trees.
    expect((await showGrove(db, noa)).ownTree.stage).toBe(2);
    expect(await db.select().from(growthEntries)).toHaveLength(2);
  });
});

describe('the grove_enabled flag', () => {
  it('is on when nothing has been cached: a device that has never met a parent still has a grove', async () => {
    expect(await readFlag(db, GROVE_ENABLED)).toBe(true);
    expect((await showGrove(db, noa)).enabled).toBe(true);
  });

  it('turns the grove off once a parent has cached it off, and on again', async () => {
    await cacheFlag(db, GROVE_ENABLED, false, new Date(T));
    expect((await showGrove(db, noa)).enabled).toBe(false);

    await cacheFlag(db, GROVE_ENABLED, true, new Date(T));
    expect((await showGrove(db, noa)).enabled).toBe(true);
  });

  it('is read independently of pet_enabled: one off does not turn the other off', async () => {
    await cacheFlag(db, 'pet_enabled', false, new Date(T));
    expect((await showGrove(db, noa)).enabled).toBe(true);

    await cacheFlag(db, GROVE_ENABLED, false, new Date(T));
    await cacheFlag(db, 'pet_enabled', true, new Date(T));
    expect((await showGrove(db, noa)).enabled).toBe(false);
  });

  it('still counts the trees while the grove is switched off', async () => {
    await cacheFlag(db, GROVE_ENABLED, false, new Date(T));
    await plant(noa, '2026-09-08');
    expect(await showGrove(db, noa)).toMatchObject({ enabled: false, ownTree: { stage: 1 } });
  });
});
