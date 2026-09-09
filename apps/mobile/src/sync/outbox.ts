import { kidOpSchema, type KidOp, type KidOpType, type RejectReason } from '@chores/shared';
import { and, asc, eq, lte } from 'drizzle-orm';
import { outbox } from '@/db/schema';
import type { DeviceDb } from '@/db/types';

/**
 * The device-local queue of ops the server has not acknowledged (docs/spec/03-sync.md). Enqueued
 * inside the same transaction as the rows the op describes, so the intent and its optimistic
 * result can never come apart.
 */

/** Ops per `/sync` request; a device that has been offline for days drains over several calls. */
export const OUTBOX_BATCH = 50;

const BACKOFF_BASE_MS = 2_000;
const BACKOFF_MAX_MS = 5 * 60_000;

/** Exponential, capped: 2s, 4s, 8s … 5 min. Deterministic, so a test can predict it. */
export function backoffMs(attempts: number): number {
  return Math.min(BACKOFF_BASE_MS * 2 ** Math.max(0, attempts - 1), BACKOFF_MAX_MS);
}

export type EnqueuedOp = { op_id: string; type: KidOpType; payload: Record<string, unknown> };

/** Adds one op to the queue, due immediately. Must run inside the caller's transaction. */
export async function enqueueOp(db: DeviceDb, op: EnqueuedOp, now: Date): Promise<void> {
  const at = now.toISOString();
  await db
    .insert(outbox)
    .values({
      op_id: op.op_id,
      type: op.type,
      payload: op.payload,
      created_at: at,
      next_attempt_at: at,
    })
    .onConflictDoNothing();
}

/**
 * The ops to send now: pending, due, oldest first. Every row is parsed on the way out — a row an
 * older version of the app wrote can outlive the shape it was written in, and a queue entry the
 * server would only refuse is better surfaced here than replayed forever.
 */
export async function pendingOps(db: DeviceDb, now: Date): Promise<KidOp[]> {
  const rows = await db
    .select()
    .from(outbox)
    .where(and(eq(outbox.status, 'pending'), lte(outbox.next_attempt_at, now.toISOString())))
    .orderBy(asc(outbox.created_at))
    .limit(OUTBOX_BATCH);

  const ops: KidOp[] = [];
  for (const row of rows) {
    const parsed = kidOpSchema.safeParse({
      op_id: row.op_id,
      type: row.type,
      payload: row.payload,
    });
    if (parsed.success) ops.push(parsed.data);
    else await markRejected(db, row.op_id, 'invalid_payload');
  }
  return ops;
}

/** Ops the server refused: never retried, kept so the child can be told the tap did not stick. */
export async function rejectedOps(db: DeviceDb) {
  return db
    .select()
    .from(outbox)
    .where(eq(outbox.status, 'rejected'))
    .orderBy(asc(outbox.created_at));
}

/** Clears the refusals the child has been shown. */
export async function clearRejectedOps(db: DeviceDb): Promise<void> {
  await db.delete(outbox).where(eq(outbox.status, 'rejected'));
}

export async function dropOp(db: DeviceDb, opId: string): Promise<void> {
  await db.delete(outbox).where(eq(outbox.op_id, opId));
}

/** A refusal is final: the op stays, out of the queue, with the reason to show. */
export async function markRejected(
  db: DeviceDb,
  opId: string,
  reason: RejectReason,
): Promise<void> {
  await db.update(outbox).set({ status: 'rejected', reason }).where(eq(outbox.op_id, opId));
}

/** The request never reached a verdict: try again later, a little further out each time. */
export async function deferOps(db: DeviceDb, ops: readonly KidOp[], now: Date): Promise<void> {
  for (const op of ops) {
    const [row] = await db.select().from(outbox).where(eq(outbox.op_id, op.op_id));
    if (!row || row.status !== 'pending') continue;
    const attempts = row.attempts + 1;
    await db
      .update(outbox)
      .set({
        attempts,
        next_attempt_at: new Date(now.getTime() + backoffMs(attempts)).toISOString(),
      })
      .where(eq(outbox.op_id, op.op_id));
  }
}
