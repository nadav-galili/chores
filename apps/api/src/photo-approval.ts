import { and, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import { reconcileChild } from './apply-ops.ts';
import type { Db } from './db/client.ts';
import { choreInstances, completions } from './db/schema.ts';
import { applyRejection } from './rejection.ts';
import { householdScope, type ScopedEnv } from './scope.ts';

export type ApprovePhotoResult = 'approved' | 'already_accepted';

/**
 * M3.13 photo proof decision (spec #59, photo-proof section).
 *
 * Contract assumed from M3.12, which is built in parallel: a photo-waiting completion is a
 * `completions` row with `status = 'pending_photo'` and `photo_key` set, beside a
 * `chore_instances` row with `status = 'pending_photo'`. No new pay path: approval flips the
 * completion to `accepted`, marks the instance `done`, and runs the same `reconcileChild` the
 * Redo Window uses — so a late approval of a past chore date pays that date's coins, bonus and
 * streak and appends a growth entry iff the day is newly complete (M2.2, ADR-0011).
 *
 * A parent reads the waiting photo through `GET .../completions/:id/photo` (uploads.ts); the
 * today screen names the waiting completion (today.ts), so approving is the whole action.
 */
export function photoApprovalRoutes(db: Db) {
  const app = new Hono<ScopedEnv>();
  app.use('/households/:householdId/completions/*', householdScope(db));

  app.post('/households/:householdId/completions/:completionId/approve', async (c) => {
    const householdId = c.get('householdId');
    const parentId = c.get('parentId');
    const completionId = c.req.param('completionId');
    if (!z.string().uuid().safeParse(completionId).success) {
      return c.json({ error: 'not_found' }, 404);
    }
    const now = new Date();

    const result = await db.transaction(async (tx) => {
      // Locked: two parents approving at once queue here, and the second reads the first's
      // `accepted` and writes nothing, so there is one payment.
      const [completion] = await tx
        .select()
        .from(completions)
        .where(and(eq(completions.id, completionId), eq(completions.householdId, householdId)))
        .for('update');
      if (!completion) return null;
      if (completion.status === 'accepted') return 'already_accepted' as const;
      // Only a photo-waiting completion can be approved: a rejected or undone one stopped
      // counting, and approving it would pay work a parent already refused or a child withdrew.
      if (completion.status !== 'pending_photo') return 'not_pending' as const;

      await tx
        .update(completions)
        .set({ status: 'accepted' })
        .where(eq(completions.id, completion.id));
      await tx
        .update(choreInstances)
        .set({ status: 'done' })
        .where(eq(choreInstances.id, completion.instanceId));
      await reconcileChild(tx, {
        childId: completion.childId,
        householdId,
        now,
        createdBy: parentId,
      });
      return 'approved' as const;
    });

    if (!result) return c.json({ error: 'not_found' }, 404);
    if (result === 'not_pending') return c.json({ error: 'not_pending' }, 409);
    return c.json({ status: result } satisfies { status: ApprovePhotoResult });
  });

  // Declining a photo is rejecting it: the same transaction as `POST .../reject`, so there is
  // one way to say no. A pending completion never paid, so this writes no clawback.
  app.post('/households/:householdId/completions/:completionId/decline', async (c) => {
    const householdId = c.get('householdId');
    const parentId = c.get('parentId');
    const completionId = c.req.param('completionId');
    if (!z.string().uuid().safeParse(completionId).success) {
      return c.json({ error: 'not_found' }, 404);
    }

    const result = await db.transaction((tx) =>
      applyRejection(tx, { completionId, householdId, parentId, now: new Date() }),
    );

    if (!result) return c.json({ error: 'not_found' }, 404);
    return c.json({ status: result });
  });

  return app;
}
