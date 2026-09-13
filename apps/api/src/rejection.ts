import type { RejectCompletionResult } from '@chores/shared';
import { and, eq, ne } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import { reconcileChild, type Tx } from './apply-ops.ts';
import type { Db } from './db/client.ts';
import { choreInstances, completions } from './db/schema.ts';
import { householdScope, type ScopedEnv } from './scope.ts';

/**
 * `reject_completion` (docs/spec/03-sync.md, Ops): a parent decides after the fact that a
 * completion does not count. The completion row stays — it is append-only and only its status
 * moves — the instance returns as a redo, and the reconciliation claws back exactly what the
 * completion paid, the day and streak bonuses it triggered included. The tree the day grew stands
 * (ADR-0011). No UI in M1; the kid device learns of it on its next pull.
 *
 * The spec files this under parent-token ops, but only kid devices have an outbox: a parent app
 * writes over plain REST, the way `upsert_chore` and `delete_chore` already do. Nothing here needs
 * `applied_ops` — the endpoint is idempotent because a rejected completion is already rejected.
 */
/**
 * The rejection transaction, shared verbatim by `POST .../reject` and the photo-proof decline
 * (M3.13): there is one way to say no. Returns null when the completion is not in this
 * household. A `pending_photo` completion declined here never paid, so reconciliation writes
 * nothing and the instance still goes back as a redo.
 */
export async function applyRejection(
  tx: Tx,
  ctx: { completionId: string; householdId: string; parentId: string; now: Date },
): Promise<RejectCompletionResult | null> {
  // Locked for the transaction: two parents rejecting at once queue here, and the second
  // reads the first's `rejected` and writes nothing, so there is one clawback.
  const [completion] = await tx
    .select()
    .from(completions)
    .where(and(eq(completions.id, ctx.completionId), eq(completions.householdId, ctx.householdId)))
    .for('update');
  if (!completion) return null;
  // The child's own undo got there first: the completion already stopped counting and the
  // instance is already due, so there is nothing left to claw back.
  if (completion.status === 'undone') return 'already_undone' as const;
  if (completion.status === 'rejected') return 'rejected' as const;

  await tx
    .update(completions)
    .set({ status: 'rejected', rejectedBy: ctx.parentId, rejectedAt: ctx.now })
    .where(eq(completions.id, completion.id));
  // Only the completion that is still holding the instance up sends it back for a redo. A
  // child who re-completed after an earlier rejection has a newer accepted row on the same
  // instance, and rejecting the old one must not tell them to redo work they have redone.
  const [live] = await tx
    .select({ id: completions.id })
    .from(completions)
    .where(
      and(
        eq(completions.instanceId, completion.instanceId),
        eq(completions.status, 'accepted'),
        ne(completions.id, completion.id),
      ),
    );
  if (!live) {
    await tx
      .update(choreInstances)
      .set({ status: 'redo' })
      .where(eq(choreInstances.id, completion.instanceId));
  }
  await reconcileChild(tx, {
    childId: completion.childId,
    householdId: ctx.householdId,
    now: ctx.now,
    createdBy: ctx.parentId,
  });
  return 'rejected' as const;
}

export function rejectionRoutes(db: Db) {
  const app = new Hono<ScopedEnv>();
  app.use('/households/:householdId/completions/*', householdScope(db));

  app.post('/households/:householdId/completions/:completionId/reject', async (c) => {
    const householdId = c.get('householdId');
    const parentId = c.get('parentId');
    const completionId = c.req.param('completionId');
    if (!z.string().uuid().safeParse(completionId).success) {
      return c.json({ error: 'not_found' }, 404);
    }
    const now = new Date();

    const result = await db.transaction((tx) =>
      applyRejection(tx, { completionId, householdId, parentId, now }),
    );

    if (!result) return c.json({ error: 'not_found' }, 404);
    return c.json({ status: result } satisfies { status: RejectCompletionResult });
  });

  return app;
}
