import type { KidOp, SyncRequest, SyncResponse } from '@chores/shared';
import { and, eq } from 'drizzle-orm';
import { choreInstances, completions } from '@/db/schema';
import type { DeviceDb } from '@/db/types';
import { applyPull, inTransaction, readCursor } from './engine';
import { reconcileLocal, tapContext, type ChildContext, type TapContext } from './local';
import { forgetRegisteredToken } from './notifications';
import { deferOps, dropOp, markRejected, pendingOps } from './outbox';

export type SyncCall = (body: SyncRequest) => Promise<SyncResponse>;

let inFlight: Promise<void> | null = null;

/**
 * Undoes the optimistic rows of an op the server refused, or of a completion it filed under a
 * different chore date. The server's own rows arrive as changes and are already applied, so this
 * only has to clear what the device invented.
 */
async function repair(
  db: DeviceDb,
  ctx: TapContext,
  op: KidOp,
  kind: 'rejected' | 'date_adjusted',
) {
  if (op.type === 'complete') {
    if (kind === 'rejected') {
      // Completions are never deleted, on the device no more than on the server: the row stays
      // and stops counting, exactly as the child's own undo leaves it.
      await db
        .update(completions)
        .set({ status: 'undone' })
        .where(eq(completions.id, op.payload.completion_id));
    }
    // The instance the device thought it completed: on a refusal there is nothing to show for
    // the tap, and on an adjusted date the server filed the completion against another day.
    await db
      .update(choreInstances)
      .set({ status: 'due' })
      .where(
        and(
          eq(choreInstances.chore_id, op.payload.chore_id),
          eq(choreInstances.chore_date, op.payload.chore_date),
        ),
      );
    return;
  }
  if (op.type === 'register_push_token') {
    // Nothing local was invented, but the device believes the server holds this token: a refusal
    // means it does not, so forget it and let the next open register again.
    if (kind === 'rejected') await forgetRegisteredToken(db, ctx.now);
    return;
  }
  if (op.type === 'request_redemption' || op.type === 'cancel_redemption') {
    // A refused redemption op leaves a balance that lies until the next full pull, so its rows
    // have to go — the redemption, the `redeem` entry and, for a cancel, the refund (ADR-0014).
    // That rollback is #43, and it is deliberately not silently half-done here.
    return;
  }
  if (op.type !== 'uncomplete') return;
  if (kind !== 'rejected') return;
  // The undo was refused, so the completion still stands.
  const [completion] = await db
    .select()
    .from(completions)
    .where(eq(completions.id, op.payload.completion_id));
  if (!completion) return;
  await db.update(completions).set({ status: 'accepted' }).where(eq(completions.id, completion.id));
  await db
    .update(choreInstances)
    .set({ status: 'done' })
    .where(eq(choreInstances.id, completion.instance_id));
}

/** Takes each verdict off the queue and, where the server disagreed with the device, repairs. */
async function settle(
  db: DeviceDb,
  ctx: TapContext,
  sent: readonly KidOp[],
  response: SyncResponse,
): Promise<void> {
  if (!response.acked.length && !response.rejected.length) return;
  const byId = new Map(sent.map((op) => [op.op_id, op]));
  const verdicts = [
    ...response.acked
      .filter((a) => a.date_adjusted)
      .map((a) => ({ ...a, kind: 'date_adjusted' as const })),
    ...response.rejected.map((r) => ({ ...r, kind: 'rejected' as const })),
  ];

  await inTransaction(db, async () => {
    for (const ack of response.acked) await dropOp(db, ack.op_id);
    for (const rejection of response.rejected) {
      await markRejected(db, rejection.op_id, rejection.reason);
    }
    let repaired = false;
    for (const verdict of verdicts) {
      const op = byId.get(verdict.op_id);
      if (!op) continue;
      await repair(db, ctx, op, verdict.kind);
      repaired = true;
    }
    if (repaired) await reconcileLocal(db, ctx);
  });
}

/**
 * One sync run: drain the outbox and pull every waiting change-log page, applying each atomically
 * and persisting the cursor as it goes. Concurrent callers (a tap, a foreground, a screen opening)
 * share one run. Errors propagate with the ops left queued for the next attempt: the caller decides
 * what a revoked device or a dead network means.
 */
export function syncNow(db: DeviceDb, child: ChildContext, call: SyncCall): Promise<void> {
  inFlight ??= (async () => {
    try {
      for (;;) {
        const ctx = tapContext(child);
        const ops = await pendingOps(db, ctx.now);
        const cursor = await readCursor(db);
        let response: SyncResponse;
        try {
          response = await call({ device_id: ctx.deviceId, cursor, ops });
        } catch (e) {
          await inTransaction(db, () => deferOps(db, ops, ctx.now));
          throw e;
        }
        await applyPull(db, response);
        await settle(db, ctx, ops, response);
        // Another page, or ops that did not fit in one batch. Continuing requires progress —
        // a settled op or a further page — so a server that answers nothing cannot spin this.
        const settled = response.acked.length + response.rejected.length;
        if (settled === 0 && ops.length) {
          // The ops reached a server that said nothing about them: back off rather than resend
          // them on the next run as if they were fresh.
          await inTransaction(db, () => deferOps(db, ops, ctx.now));
        }
        if (!response.has_more && settled === 0) return;
        if (!response.has_more && !(await pendingOps(db, ctx.now)).length) return;
      }
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}
