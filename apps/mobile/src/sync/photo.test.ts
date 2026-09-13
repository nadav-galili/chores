import { beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { instanceId, uuid7 } from '@chores/shared';
import { openTestDb } from '@/db/test-db';
import type { DeviceDb } from '@/db/types';
import {
  choreAssignees,
  choreInstances,
  chores,
  completions,
  daySummaries,
  ledgerEntries,
  outbox,
  photoUploads,
  xpEvents,
} from '@/db/schema';
import { materializeToday } from './engine';
import { tapContext, tapDone, tapPhotoDone, balanceOf, type ChildContext } from './local';
import { pendingOps, rejectedOps } from './outbox';
import { retakePhoto, uploadPendingPhotos, type PhotoTransfer } from './photo';

let db: DeviceDb;
const childId = uuid7();
const householdId = uuid7();
const deviceId = uuid7();
const parentId = uuid7();
const T = '2026-09-09T10:00:00.000Z';
const TODAY = '2026-09-09';
const NOW = new Date(T);

const child: ChildContext = {
  householdId,
  childId,
  deviceId,
  tz: 'Asia/Jerusalem',
  dayBoundaryHour: 0,
};
const ctx = () => tapContext(child, NOW);

/** A daily photo chore assigned to this child, with today's instance materialized. */
async function seedPhotoChore() {
  const id = uuid7();
  await db.insert(chores).values({
    id,
    household_id: householdId,
    title: 'Tidy room',
    icon: '🧹',
    kind: 'daily',
    weekday_mask: null,
    start_date: null,
    end_date: null,
    due_date: null,
    requires_photo: true,
    version: 1,
    updated_at: T,
    updated_by: parentId,
    deleted_at: null,
    field_clocks: {},
  });
  await db.insert(choreAssignees).values({ chore_id: id, child_id: childId });
  await materializeToday(db, childId, TODAY);
  return { chore_id: id, id: instanceId(id, childId, TODAY) };
}

const photo = { local_uri: 'file:///photo.jpg', content_type: 'image/jpeg' as const };

const okTransfer: PhotoTransfer = {
  presign: (completion_id: string) =>
    Promise.resolve({
      key: `children/${childId}/completions/${completion_id}`,
      upload_url: 'https://r2.example/upload',
    }),
  upload: () => Promise.resolve(),
};

beforeEach(async () => {
  db = await openTestDb();
});

describe('tapPhotoDone', () => {
  it('writes pending_photo with its upload row and pays nothing', async () => {
    const instance = await seedPhotoChore();
    const paid = await tapPhotoDone(db, ctx(), instance, photo);

    expect(paid).toBe(0);
    expect(await balanceOf(db, childId)).toBe(0);
    expect(await db.select().from(ledgerEntries)).toEqual([]);
    expect(await db.select().from(xpEvents)).toEqual([]);

    const [completion] = await db.select().from(completions);
    expect(completion).toMatchObject({
      chore_id: instance.chore_id,
      status: 'pending_photo',
      photo_key: null,
    });

    const [inst] = await db.select().from(choreInstances).where(eq(choreInstances.id, instance.id));
    expect(inst!.status).toBe('pending_photo');

    // The photo is queued; the complete op is held back until the upload succeeds.
    expect(await db.select().from(photoUploads)).toHaveLength(1);
    expect(await pendingOps(db, NOW)).toEqual([]);

    // The day's counters do not count a completion that is not a Completion yet.
    const [summary] = await db
      .select()
      .from(daySummaries)
      .where(eq(daySummaries.child_id, childId));
    expect(summary?.done_count ?? 0).toBe(0);
    expect(summary?.complete ?? false).toBe(false);
  });

  it('does not clobber an instance that is already done', async () => {
    const instance = await seedPhotoChore();
    await tapDone(db, ctx(), instance);
    const [done] = await db.select().from(choreInstances).where(eq(choreInstances.id, instance.id));
    expect(done!.status).toBe('done');

    await tapPhotoDone(db, ctx(), instance, photo);
    const [after] = await db
      .select()
      .from(choreInstances)
      .where(eq(choreInstances.id, instance.id));
    expect(after!.status).toBe('done');
  });
});

describe('uploadPendingPhotos', () => {
  it('enqueues the complete op with the server-chosen key once the upload succeeds', async () => {
    const instance = await seedPhotoChore();
    await tapPhotoDone(db, ctx(), instance, photo);

    const uploaded = await uploadPendingPhotos(db, NOW, okTransfer);
    expect(uploaded).toBe(1);

    const [queued] = await db.select().from(photoUploads);
    expect(queued).toBeUndefined();

    const ops = await pendingOps(db, NOW);
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({ type: 'complete' });
    const payload = ops[0]!.payload as Record<string, unknown>;
    const [completion] = await db.select().from(completions);
    expect(payload.photo_key).toBe(`children/${childId}/completions/${completion!.id}`);
    expect(completion!.photo_key).toBe(payload.photo_key);
    expect(payload).toMatchObject({
      completion_id: completion!.id,
      chore_id: instance.chore_id,
      chore_date: TODAY,
    });
  });

  it('leaves a failed upload queued with backoff, never rejected', async () => {
    const instance = await seedPhotoChore();
    await tapPhotoDone(db, ctx(), instance, photo);

    const failing: PhotoTransfer = {
      ...okTransfer,
      upload: () => Promise.reject(new Error('network down')),
    };
    const uploaded = await uploadPendingPhotos(db, NOW, failing);
    expect(uploaded).toBe(0);

    const [queued] = await db.select().from(photoUploads);
    expect(queued).toMatchObject({ attempts: 1 });
    expect(new Date(queued!.next_attempt_at).getTime()).toBeGreaterThan(NOW.getTime());

    // Nothing reached the outbox, and nothing was refused: the server heard nothing.
    expect(await pendingOps(db, NOW)).toEqual([]);
    expect(await db.select().from(outbox)).toEqual([]);
    expect(await rejectedOps(db)).toEqual([]);

    const [completion] = await db.select().from(completions);
    expect(completion).toMatchObject({ status: 'pending_photo', photo_key: null });
  });

  it('retries a queued photo on the next run and then sends it', async () => {
    const instance = await seedPhotoChore();
    await tapPhotoDone(db, ctx(), instance, photo);
    const failing: PhotoTransfer = {
      ...okTransfer,
      upload: vi.fn(() => Promise.reject(new Error('network down'))),
    };
    await uploadPendingPhotos(db, NOW, failing);
    expect(failing.upload).toHaveBeenCalledTimes(1);

    // Not due yet: the backoff holds it.
    expect(await uploadPendingPhotos(db, NOW, okTransfer)).toBe(0);
    // Later it is due again and the op goes out with the key.
    const later = new Date(NOW.getTime() + 60_000);
    expect(await uploadPendingPhotos(db, later, okTransfer)).toBe(1);
    expect(await pendingOps(db, later)).toHaveLength(1);
  });
});

describe('retakePhoto', () => {
  it('swaps the queued bytes while the photo is still waiting', async () => {
    const instance = await seedPhotoChore();
    await tapPhotoDone(db, ctx(), instance, photo);
    const [queued] = await db.select().from(photoUploads);

    expect(await retakePhoto(db, queued!.completion_id, 'file:///better.jpg', NOW)).toBe(true);
    const [after] = await db.select().from(photoUploads);
    expect(after).toMatchObject({ local_uri: 'file:///better.jpg', attempts: 0 });

    // Still one waiting completion, still no op: the retake replaced the bytes, not the tap.
    expect(await db.select().from(completions)).toHaveLength(1);
    expect(await pendingOps(db, NOW)).toEqual([]);
  });

  it('says no when the photo already left', async () => {
    expect(await retakePhoto(db, uuid7(), 'file:///late.jpg', NOW)).toBe(false);
  });
});
