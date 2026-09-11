import {
  redeemEntryId,
  redemptionRefundId,
  type KidOp,
  type RedemptionStatus,
  type SyncRequest,
  type SyncResponse,
} from '@chores/shared';
import { and, eq, inArray } from 'drizzle-orm';
import { choreInstances, completions, ledgerEntries, redemptions } from '@/db/schema';
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
 *
 * One branch per op type, exhaustively: what a refusal undoes is a question only the op that
 * wrote the rows can answer, and an op with nothing to undo says so in its own branch rather
 * than by reaching someone else's. The `never` in the default is what keeps that true as ops
 * are added. Runs inside the caller's transaction, with the op still in the outbox, so a phone
 * that dies mid-drain finds the queue and the rows telling the same story either way.
 */
async function repair(
  db: DeviceDb,
  ctx: TapContext,
  op: KidOp,
  kind: 'rejected' | 'date_adjusted',
): Promise<void> {
  switch (op.type) {
    case 'complete': {
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

    case 'uncomplete': {
      if (kind !== 'rejected') return;
      // The undo was refused, so the completion still stands.
      const [completion] = await db
        .select()
        .from(completions)
        .where(eq(completions.id, op.payload.completion_id));
      if (!completion) return;
      await db
        .update(completions)
        .set({ status: 'accepted' })
        .where(eq(completions.id, completion.id));
      await db
        .update(choreInstances)
        .set({ status: 'done' })
        .where(eq(choreInstances.id, completion.instance_id));
      return;
    }

    case 'register_push_token': {
      // Nothing local was invented, but the device believes the server holds this token: a refusal
      // means it does not, so forget it and let the next open register again.
      if (kind === 'rejected') await forgetRegisteredToken(db, ctx.now);
      return;
    }

    case 'request_redemption': {
      // Only a `complete` is ever filed under another Chore Date, so this verdict cannot be one;
      // saying so explicitly is the point — there is nothing here to undo, and no branch below
      // may be reached by falling through to it.
      if (kind !== 'rejected') return;
      const { redemption_id } = op.payload;
      // The one rollback that deletes rather than marks. "Append-only rows" is about the rows the
      // server has accepted: a refused request was never written there, so the `redemptions` row
      // and the `redeem` entry are this device's own inventions, and leaving them behind is a
      // balance that lies until the next full pull (ADR-0014, docs/spec/03-sync.md).
      //
      // The refund goes with them: a child who asked and then changed their mind before this sync
      // wrote one too, and clearing the whole redemption here leaves nothing for the cancel's own
      // rollback to find, whichever of the two verdicts is handled first.
      await db
        .delete(ledgerEntries)
        .where(
          inArray(ledgerEntries.id, [
            redeemEntryId(redemption_id),
            redemptionRefundId(redemption_id),
          ]),
        );
      await db.delete(redemptions).where(eq(redemptions.id, redemption_id));
      return;
    }

    case 'cancel_redemption': {
      if (kind !== 'rejected') return;
      const { redemption_id } = op.payload;
      const [row] = await db.select().from(redemptions).where(eq(redemptions.id, redemption_id));
      // Gone with the refused request that created it, or already replaced by the server's own
      // row — a parent's decline writes the same refund under the same id (ADR-0014), so once the
      // pull has landed there is nothing left here that this device invented.
      if (!row || row.status !== 'cancelled') return;
      await db.delete(ledgerEntries).where(eq(ledgerEntries.id, redemptionRefundId(redemption_id)));
      // Back to what the child's cancel found: a request still waiting on a parent. Whatever the
      // parent actually decided arrives as a change and overwrites this row with itself.
      await db
        .update(redemptions)
        .set({ status: 'requested' satisfies RedemptionStatus, decided_at: null })
        .where(eq(redemptions.id, redemption_id));
      return;
    }

    default: {
      // Rollback is defined per op type, never guessed. A new kid op stops compiling here until
      // it says what a refusal undoes — including saying that it undoes nothing.
      const unhandled: never = op;
      void unhandled;
      return;
    }
  }
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
      // The screen this lands on is a child's, and there is nothing a 7-year-old can do with
      // `insufficient_coins`: they see the calm strip the refusals already raise, and the cause is
      // said out loud here instead (CODING_STANDARDS.md, "A catch never discards its cause"). The
      // op type and the reason only — no first name, pet name, chore title or join code (ADR-0009).
      console.error('op refused', byId.get(rejection.op_id)?.type ?? 'unknown', rejection.reason);
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
