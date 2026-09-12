import { beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import {
  COINS_PER_CHORE,
  DAY_COMPLETE_BONUS,
  growthId,
  instanceId,
  uuid7,
  type IsoDate,
  type ParentToday,
} from '@chores/shared';
import { createApp } from './app.ts';
import type { Db } from './db/client.ts';
import {
  choreInstances,
  completions,
  daySummaries,
  growthEntries,
  ledgerEntries,
} from './db/schema.ts';
import { asParent, fakeVerifyToken } from './test/auth.ts';
import { freshDb } from './test/db.ts';
import { setupHousehold, testToday } from './test/household.ts';

let db: Db;
let app: ReturnType<typeof createApp>;

beforeAll(async () => {
  db = await freshDb();
  app = createApp(db, { verifyToken: fakeVerifyToken });
});

/**
 * The `pending_photo` completion shape M3.12 writes (spec #59, photo-proof section), inserted
 * directly so this suite does not depend on that ticket's branch: a `pending_photo` completion
 * carrying `photo_key`, beside a `pending_photo` instance. It pays nothing until approved.
 */
async function pendingPhoto(clerkUserId: string, choreDate: IsoDate = testToday()) {
  const home = await setupHousehold(app, clerkUserId);
  const choreId = await home.addChore('Tidy room', [home.noa.id]);
  const key = instanceId(choreId, home.noa.id, choreDate);
  const completionId = uuid7();
  await db.insert(choreInstances).values({
    id: key,
    choreId,
    childId: home.noa.id,
    householdId: home.householdId,
    choreDate,
    status: 'pending_photo',
  });
  await db.insert(completions).values({
    id: completionId,
    instanceId: key,
    choreId,
    childId: home.noa.id,
    householdId: home.householdId,
    choreDate,
    completedAt: new Date(),
    deviceId: home.noa.session.device_id,
    photoKey: `children/${home.noa.id}/completions/${completionId}`,
    status: 'pending_photo',
  });
  return { ...home, choreId, instanceKey: key, completionId, choreDate };
}

const yesterday = (): IsoDate => {
  const [y, m, d] = testToday().split('-').map(Number);
  const back = new Date(Date.UTC(y!, m! - 1, d!, 12) - 86_400_000);
  return back.toISOString().slice(0, 10) as IsoDate;
};

const approve = (clerkUserId: string, householdId: string, completionId: string) =>
  app.request(
    `/households/${householdId}/completions/${completionId}/approve`,
    asParent(clerkUserId, { method: 'POST' }),
  );

const decline = (clerkUserId: string, householdId: string, completionId: string) =>
  app.request(
    `/households/${householdId}/completions/${completionId}/decline`,
    asParent(clerkUserId, { method: 'POST' }),
  );

const reject = (clerkUserId: string, householdId: string, completionId: string) =>
  app.request(
    `/households/${householdId}/completions/${completionId}/reject`,
    asParent(clerkUserId, { method: 'POST' }),
  );

const balance = async (childId: string) => {
  const rows = await db
    .select({ coins: ledgerEntries.coins })
    .from(ledgerEntries)
    .where(eq(ledgerEntries.childId, childId));
  return rows.reduce((sum, r) => sum + r.coins, 0);
};

const ledgerCount = async (childId: string) =>
  (await db.select().from(ledgerEntries).where(eq(ledgerEntries.childId, childId))).length;

describe('POST /households/:id/completions/:id/approve', () => {
  it('pays a waiting completion: accepted, done, and the earn plus the day bonus', async () => {
    const { householdId, noa, completionId, instanceKey } = await pendingPhoto('user_approve_pay');
    expect(await balance(noa.id)).toBe(0);

    const res = await approve('user_approve_pay', householdId, completionId);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'approved' });

    const [completion] = await db
      .select()
      .from(completions)
      .where(eq(completions.id, completionId));
    expect(completion).toMatchObject({ status: 'accepted' });
    const [instance] = await db
      .select()
      .from(choreInstances)
      .where(eq(choreInstances.id, instanceKey));
    expect(instance!.status).toBe('done');
    expect(await balance(noa.id)).toBe(COINS_PER_CHORE + DAY_COMPLETE_BONUS);
  });

  it('makes a past day complete for the first time and appends exactly one growth entry', async () => {
    const past = yesterday();
    const { householdId, noa, completionId } = await pendingPhoto('user_approve_past', past);

    const ok = await approve('user_approve_past', householdId, completionId);
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ status: 'approved' });

    // That date's coins, bonus and streak land through the redo machinery — no new pay path.
    expect(await balance(noa.id)).toBe(COINS_PER_CHORE + DAY_COMPLETE_BONUS);
    const [summary] = await db
      .select()
      .from(daySummaries)
      .where(and(eq(daySummaries.childId, noa.id), eq(daySummaries.choreDate, past)));
    expect(summary).toMatchObject({ dueCount: 1, doneCount: 1, complete: true });

    const trees = await db.select().from(growthEntries).where(eq(growthEntries.childId, noa.id));
    expect(trees.map((t) => [t.id, t.choreDate])).toEqual([[growthId(noa.id, past), past]]);
  });

  it('answers already_accepted and moves nothing when approved twice', async () => {
    const { householdId, noa, completionId } = await pendingPhoto('user_approve_twice');

    expect(await (await approve('user_approve_twice', householdId, completionId)).json()).toEqual({
      status: 'approved',
    });
    const paid = await balance(noa.id);
    const entries = await ledgerCount(noa.id);
    const trees = (await db.select().from(growthEntries).where(eq(growthEntries.childId, noa.id)))
      .length;

    const again = await approve('user_approve_twice', householdId, completionId);
    expect(again.status).toBe(200);
    expect(await again.json()).toEqual({ status: 'already_accepted' });

    expect(await balance(noa.id)).toBe(paid);
    expect(await ledgerCount(noa.id)).toBe(entries);
    expect(
      (await db.select().from(growthEntries).where(eq(growthEntries.childId, noa.id))).length,
    ).toBe(trees);
  });

  it('refuses a completion that stopped counting instead of paying it', async () => {
    const { householdId, completionId } = await pendingPhoto('user_approve_stale');
    await decline('user_approve_stale', householdId, completionId);

    const res = await approve('user_approve_stale', householdId, completionId);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'not_pending' });
  });

  it('refuses a keyless pending row instead of paying it', async () => {
    const home = await setupHousehold(app, 'user_approve_keyless');
    const choreId = await home.addChore('Tidy room', [home.noa.id]);
    const key = instanceId(choreId, home.noa.id, testToday());
    const completionId = uuid7();
    await db.insert(choreInstances).values({
      id: key,
      choreId,
      childId: home.noa.id,
      householdId: home.householdId,
      choreDate: testToday(),
      status: 'pending_photo',
    });
    await db.insert(completions).values({
      id: completionId,
      instanceId: key,
      choreId,
      childId: home.noa.id,
      householdId: home.householdId,
      choreDate: testToday(),
      completedAt: new Date(),
      deviceId: home.noa.session.device_id,
      photoKey: null,
      status: 'pending_photo',
    });

    const res = await approve('user_approve_keyless', home.householdId, completionId);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'not_pending' });
    expect(await balance(home.noa.id)).toBe(0);
  });

  it('does not reach another household’s completion', async () => {
    const mine = await pendingPhoto('user_approve_mine');
    const theirs = await pendingPhoto('user_approve_theirs');

    const res = await approve('user_approve_mine', mine.householdId, theirs.completionId);
    expect(res.status).toBe(404);
    const [completion] = await db
      .select()
      .from(completions)
      .where(eq(completions.id, theirs.completionId));
    expect(completion!.status).toBe('pending_photo');
    expect(await balance(theirs.noa.id)).toBe(0);
  });

  it('is reachable from the today payload: the waiting photo names its completion', async () => {
    const { householdId, noa, completionId, instanceKey } =
      await pendingPhoto('user_approve_today');

    const before = (await (
      await app.request(`/households/${householdId}/today`, asParent('user_approve_today'))
    ).json()) as ParentToday;
    const item = before.children
      .find((c) => c.child_id === noa.id)!
      .items.find((i) => i.instance_id === instanceKey)!;
    expect(item).toMatchObject({ status: 'pending_photo', completion_id: completionId });
    expect(item.completed_at).not.toBeNull();

    await approve('user_approve_today', householdId, item.completion_id!);
    const after = (await (
      await app.request(`/households/${householdId}/today`, asParent('user_approve_today'))
    ).json()) as ParentToday;
    expect(
      after.children
        .find((c) => c.child_id === noa.id)!
        .items.find((i) => i.instance_id === instanceKey)!,
    ).toMatchObject({ status: 'done', completion_id: completionId });
  });
});

describe('POST /households/:id/completions/:id/decline', () => {
  it('is the rejection path: a waiting photo goes back as a redo and pays nothing', async () => {
    const { householdId, noa, completionId, instanceKey } = await pendingPhoto('user_decline_wait');

    const res = await decline('user_decline_wait', householdId, completionId);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'rejected' });

    const [completion] = await db
      .select()
      .from(completions)
      .where(eq(completions.id, completionId));
    expect(completion).toMatchObject({ status: 'rejected' });
    expect(completion!.rejectedBy).not.toBeNull();
    const [instance] = await db
      .select()
      .from(choreInstances)
      .where(eq(choreInstances.id, instanceKey));
    expect(instance!.status).toBe('redo');
    // It never paid, so there is nothing to claw back.
    expect(await balance(noa.id)).toBe(0);
    expect(await ledgerCount(noa.id)).toBe(0);
  });

  it('answers exactly what reject answers on the same waiting shape', async () => {
    const declined = await pendingPhoto('user_decline_same');
    const rejected = await pendingPhoto('user_reject_same');

    const d = await decline('user_decline_same', declined.householdId, declined.completionId);
    const r = await reject('user_reject_same', rejected.householdId, rejected.completionId);
    expect(await d.json()).toEqual(await r.json());

    const [dRow] = await db
      .select()
      .from(completions)
      .where(eq(completions.id, declined.completionId));
    const [rRow] = await db
      .select()
      .from(completions)
      .where(eq(completions.id, rejected.completionId));
    expect({ status: dRow!.status, at: !!dRow!.rejectedAt, by: !!dRow!.rejectedBy }).toEqual({
      status: rRow!.status,
      at: !!rRow!.rejectedAt,
      by: !!rRow!.rejectedBy,
    });
    const [dInst] = await db
      .select()
      .from(choreInstances)
      .where(eq(choreInstances.id, declined.instanceKey));
    const [rInst] = await db
      .select()
      .from(choreInstances)
      .where(eq(choreInstances.id, rejected.instanceKey));
    expect(dInst!.status).toBe(rInst!.status);
  });

  it('does not reach another household’s completion', async () => {
    const mine = await pendingPhoto('user_decline_mine');
    const theirs = await pendingPhoto('user_decline_theirs');

    const res = await decline('user_decline_mine', mine.householdId, theirs.completionId);
    expect(res.status).toBe(404);
    const [completion] = await db
      .select()
      .from(completions)
      .where(eq(completions.id, theirs.completionId));
    expect(completion!.status).toBe('pending_photo');
  });
});
