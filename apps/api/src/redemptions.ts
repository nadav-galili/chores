import {
  decideRedemptionInputSchema,
  redemptionDecided,
  refundEntry,
  type DecideRedemptionResult,
} from '@chores/shared';
import { and, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import type { Analytics } from './analytics.ts';
import type { Db } from './db/client.ts';
import { ledgerEntries, redemptions } from './db/schema.ts';
import { ledgerRow } from './ledger-row.ts';
import { parseBody } from './parse-body.ts';
import { householdScope, type ScopedEnv } from './scope.ts';

/**
 * A parent decides a Redemption (ADR-0014). The coins left the ledger when the child asked, so
 * approving writes nothing at all: it records who said yes. Declining refunds — and it refunds
 * under `uuid5('clawback', redeem_entry_id)`, the very id a cancel writes, so a parent deciding
 * while the child changes their mind cannot produce two refunds however the two interleave.
 *
 * A parent writes over plain REST like every other parent action; only a Kid Device has an
 * outbox. The endpoint needs no `applied_ops`: a decided redemption is already decided, and a
 * second call reads that and moves nothing.
 */
export function redemptionRoutes(db: Db, analytics: Analytics) {
  const app = new Hono<ScopedEnv>();
  app.use('/households/:householdId/redemptions/*', householdScope(db));

  app.post('/households/:householdId/redemptions/:redemptionId/decide', async (c) => {
    const householdId = c.get('householdId');
    const parentId = c.get('parentId');
    const redemptionId = c.req.param('redemptionId');
    if (!z.string().uuid().safeParse(redemptionId).success) {
      return c.json({ error: 'not_found' }, 404);
    }
    const body = await parseBody(c, decideRedemptionInputSchema);
    if (!body.ok) return body.response;
    const now = new Date();

    const result = await db.transaction(async (tx) => {
      // Locked for the transaction. The child's cancel takes the same lock, so the two orderings
      // are the only two there are: whichever arrives second reads the first's status and writes
      // nothing.
      const [row] = await tx
        .select()
        .from(redemptions)
        .where(and(eq(redemptions.id, redemptionId), eq(redemptions.householdId, householdId)))
        .for('update');
      if (!row) return null;
      // The child got there first: the refund is written and the coins are already back.
      if (row.status === 'cancelled') return 'already_cancelled' as const;
      if (row.status !== 'requested') return 'already_decided' as const;

      const decided = body.data.decision === 'approve' ? 'approved' : 'declined';
      await tx
        .update(redemptions)
        .set({ status: decided, decidedAt: now, decidedBy: parentId })
        .where(eq(redemptions.id, row.id));
      // Approval moves nothing: the coins went when the child asked. Only a decline gives back,
      // under the id a cancel shares, so the two races collapse to the one refund.
      if (decided === 'declined') {
        const refund = refundEntry({
          household_id: householdId,
          child_id: row.childId,
          redemption_id: row.id,
          cost_coins: row.costCoins,
          created_at: now.toISOString(),
          created_by: parentId,
        });
        await tx.insert(ledgerEntries).values(ledgerRow(refund, now)).onConflictDoNothing();
      }
      return decided;
    });

    if (!result) return c.json({ error: 'not_found' }, 404);
    if (result === 'approved' || result === 'declined') {
      analytics.capture({
        distinctId: c.get('clerkUserId'),
        event: redemptionDecided({ decision: result }),
        groups: { household: householdId },
      });
    }
    return c.json({ status: result } satisfies { status: DecideRedemptionResult });
  });

  return app;
}
