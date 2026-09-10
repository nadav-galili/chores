import { beforeEach, describe, expect, it } from 'vitest';
import { PET_MAX_LEVEL, uuid7 } from '@chores/shared';
import { openTestDb } from '@/db/test-db';
import type { DeviceDb } from '@/db/types';
import { children, daySummaries, petState, xpEvents } from '@/db/schema';
import { PET_ENABLED, cacheFlag, readFlag } from './flags';
import { showPet } from './pet';

let db: DeviceDb;
const childId = uuid7();
const householdId = uuid7();
const T = '2026-09-09T10:00:00.000Z';
const TODAY = '2026-09-09';

async function seedChild(pet_name = 'Pip') {
  await db.insert(children).values({
    id: childId,
    household_id: householdId,
    first_name: 'Noa',
    ui_mode: 'little',
    pet_name,
    reminder_time: null,
    sort: 0,
    created_at: T,
  });
}

const grantXp = (xp: number) =>
  db.insert(xpEvents).values({
    id: uuid7(),
    child_id: childId,
    xp,
    ref_entry_id: uuid7(),
    created_at: T,
  });

const seedDay = (due_count: number, done_count: number) =>
  db.insert(daySummaries).values({
    child_id: childId,
    chore_date: TODAY,
    due_count,
    done_count,
    complete: due_count > 0 && done_count === due_count,
    streak_after: 0,
  });

beforeEach(async () => {
  db = await openTestDb();
  await seedChild();
});

describe('showPet', () => {
  it('starts at level one, sleepy, with an empty bar and the pet’s name', async () => {
    const pet = await showPet(db, childId, TODAY);
    expect(pet).toMatchObject({ enabled: true, name: 'Pip', mood: 'sleepy' });
    expect(pet.progress).toMatchObject({ level: 1, xp: 0, into: 0, fraction: 0 });
  });

  it('counts every xp event as the level and the bar', async () => {
    await grantXp(60);
    await grantXp(70);
    const pet = await showPet(db, childId, TODAY);
    expect(pet.progress).toMatchObject({ level: 2, xp: 130, into: 30, needed: 200 });
  });

  it('tops out at the highest level', async () => {
    await grantXp(9_000);
    const pet = await showPet(db, childId, TODAY);
    expect(pet.progress).toMatchObject({ level: PET_MAX_LEVEL, atMax: true, fraction: 1 });
  });

  it('remembers the level it showed, so a clawback empties the bar but never demotes the pet', async () => {
    await grantXp(320);
    expect((await showPet(db, childId, TODAY)).progress.level).toBe(3);
    const [remembered] = await db.select().from(petState);
    expect(remembered!.shown_level).toBe(3);

    await grantXp(-300);
    const after = await showPet(db, childId, TODAY);
    expect(after.progress).toMatchObject({ level: 3, xp: 20, into: 0, fraction: 0 });
  });

  it('is happy on a complete day, content once something is done, sleepy before that', async () => {
    expect((await showPet(db, childId, TODAY)).mood).toBe('sleepy');
    await seedDay(3, 0);
    expect((await showPet(db, childId, TODAY)).mood).toBe('sleepy');

    await db.delete(daySummaries);
    await seedDay(3, 1);
    expect((await showPet(db, childId, TODAY)).mood).toBe('content');

    await db.delete(daySummaries);
    await seedDay(3, 3);
    expect((await showPet(db, childId, TODAY)).mood).toBe('happy');
  });

  it('is sleepy, never worse, on a day the child has nothing due', async () => {
    await seedDay(0, 0);
    expect((await showPet(db, childId, TODAY)).mood).toBe('sleepy');
  });

  it('reads yesterday’s mood from yesterday, not today’s row', async () => {
    await seedDay(2, 2);
    expect((await showPet(db, childId, '2026-09-10')).mood).toBe('sleepy');
  });
});

describe('the pet_enabled flag', () => {
  it('is on when nothing has been cached: a device that has never met a parent still has a pet', async () => {
    expect(await readFlag(db, PET_ENABLED)).toBe(true);
    expect((await showPet(db, childId, TODAY)).enabled).toBe(true);
  });

  it('turns the pet off once a parent has cached it off, and on again', async () => {
    await cacheFlag(db, PET_ENABLED, false, new Date(T));
    expect(await readFlag(db, PET_ENABLED)).toBe(false);
    expect((await showPet(db, childId, TODAY)).enabled).toBe(false);

    await cacheFlag(db, PET_ENABLED, true, new Date(T));
    expect((await showPet(db, childId, TODAY)).enabled).toBe(true);
  });

  it('still reports the level and mood while the pet is switched off', async () => {
    await cacheFlag(db, PET_ENABLED, false, new Date(T));
    await grantXp(150);
    await seedDay(1, 1);
    const pet = await showPet(db, childId, TODAY);
    expect(pet).toMatchObject({ enabled: false, mood: 'happy' });
    expect(pet.progress.level).toBe(2);
  });
});
