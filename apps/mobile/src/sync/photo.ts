import { uuid7 } from '@chores/shared';
import { and, asc, eq, lte } from 'drizzle-orm';
import { completions, photoUploads } from '@/db/schema';
import type { DeviceDb } from '@/db/types';
import { inTransaction } from './engine';
import { backoffMs, enqueueOp } from './outbox';

/**
 * The second half of a photo tap (M3.12, ADR-0017). The completion was written `pending_photo`
 * with its upload row in one transaction (`sync/local`); this drains those rows: presign, PUT
 * the bytes to R2, and only then enqueue the `complete` op carrying the server-chosen
 * `photo_key`. The device never chooses a key — it echoes the presign's answer into the op.
 *
 * Offline is the ordinary case, not an error: with no network the rows sit here and the next
 * run uploads them. A failed upload keeps the row queued with backoff and never rejects it —
 * the server has heard nothing, so there is nothing to refuse.
 */

export type PresignResult = { key: string; upload_url: string };

export type PhotoTransfer = {
  /** The kid presign route: names only the completion, and answers with the key and the URL. */
  presign: (completion_id: string, content_type: string) => Promise<PresignResult>;
  /** PUTs this device's bytes at `local_uri` to the presigned URL. */
  upload: (upload_url: string, local_uri: string, content_type: string) => Promise<void>;
};

/** The photos due for an attempt now, oldest first. */
export async function pendingUploads(db: DeviceDb, now: Date) {
  return db
    .select()
    .from(photoUploads)
    .where(lte(photoUploads.next_attempt_at, now.toISOString()))
    .orderBy(asc(photoUploads.created_at));
}

/**
 * The child photographs the same chore again while the first photo is still queued: the waiting
 * completion stands, and the bytes it will carry are swapped. False when nothing is queued for
 * the completion — the photo already left, and a retake has nothing to replace.
 */
export async function retakePhoto(
  db: DeviceDb,
  completionId: string,
  local_uri: string,
  now: Date,
): Promise<boolean> {
  const [row] = await db
    .select({ id: photoUploads.completion_id })
    .from(photoUploads)
    .where(eq(photoUploads.completion_id, completionId));
  if (!row) return false;
  await db
    .update(photoUploads)
    .set({ local_uri, attempts: 0, next_attempt_at: now.toISOString() })
    .where(eq(photoUploads.completion_id, completionId));
  return true;
}

/**
 * A retake addressed by instance, for the row the child is looking at: finds the waiting
 * completion on the instance and swaps its queued bytes. False when there is no waiting
 * completion — the photo already left, or the chore was never photographed.
 */
export async function retakePhotoForInstance(
  db: DeviceDb,
  instanceId: string,
  local_uri: string,
  now: Date,
): Promise<boolean> {
  const [completion] = await db
    .select({ id: completions.id })
    .from(completions)
    .where(and(eq(completions.instance_id, instanceId), eq(completions.status, 'pending_photo')));
  if (!completion) return false;
  return retakePhoto(db, completion.id, local_uri, now);
}

/**
 * Uploads every due photo and queues its `complete` op. Returns how many left the device.
 * Failures stay queued with backoff; they are never rejected and never touch the outbox.
 */
export async function uploadPendingPhotos(
  db: DeviceDb,
  now: Date,
  transfer: PhotoTransfer,
): Promise<number> {
  const rows = await pendingUploads(db, now);
  let uploaded = 0;
  for (const row of rows) {
    let key: string;
    try {
      const presigned = await transfer.presign(row.completion_id, row.content_type);
      await transfer.upload(presigned.upload_url, row.local_uri, row.content_type);
      key = presigned.key;
    } catch (e) {
      // The bytes are still on this device and the server heard nothing, so this is a later
      // attempt, never a refusal. The cause is logged, not shown: there is nothing a child can
      // do with it, and the waiting copy already covers the state (ADR-0009: the id below is a
      // random UUID, never a name, title or code).
      console.error('photo upload failed', row.completion_id, e);
      const attempts = row.attempts + 1;
      await db
        .update(photoUploads)
        .set({
          attempts,
          next_attempt_at: new Date(now.getTime() + backoffMs(attempts)).toISOString(),
        })
        .where(eq(photoUploads.completion_id, row.completion_id));
      continue;
    }
    // The key fills in the waiting completion the tap wrote, and the op that carries it is
    // enqueued in the same transaction — the three can never come apart. (Filling `photo_key`
    // is the pending write completing, the way a status move is — the one exception
    // docs/spec/02-data-model.md names to the append-only rule, and it happens once.)
    await inTransaction(db, async () => {
      await db
        .update(completions)
        .set({ photo_key: key })
        .where(eq(completions.id, row.completion_id));
      await db.delete(photoUploads).where(eq(photoUploads.completion_id, row.completion_id));
      await enqueueOp(
        db,
        {
          op_id: uuid7(),
          type: 'complete',
          payload: {
            completion_id: row.completion_id,
            chore_id: row.chore_id,
            chore_date: row.chore_date,
            completed_at: row.completed_at,
            photo_key: key,
          },
        },
        now,
      );
    });
    uploaded += 1;
  }
  return uploaded;
}
