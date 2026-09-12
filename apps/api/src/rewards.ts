import type { Reward } from '@chores/shared';
import { and, asc, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import type { Db } from './db/client.ts';
import { rewards } from './db/schema.ts';
import { parseBody } from './parse-body.ts';
import { householdScope, type ScopedEnv } from './scope.ts';
import { rewardToApi } from './serialize.ts';

const setActiveSchema = z.object({ active: z.boolean() });

/**
 * The household's reward catalog, as the parent sees it. The free tier ships the built-ins and
 * lets a parent hide the ones they are not willing to give: hiding is `active = false` on the
 * household's own copied row, which is the whole reason the catalog is per household rather than
 * shared. The `rewards` change-log trigger carries the flip to every Kid Device on its next pull.
 *
 * Creating a reward is not offered here — a custom reward is M3's `custom_reward` gate.
 */
export function rewardRoutes(db: Db) {
  const app = new Hono<ScopedEnv>();
  app.use('/households/:householdId/rewards', householdScope(db));
  app.use('/households/:householdId/rewards/*', householdScope(db));

  app.get('/households/:householdId/rewards', async (c) => {
    const rows = await db
      .select()
      .from(rewards)
      .where(eq(rewards.householdId, c.get('householdId')))
      .orderBy(asc(rewards.sort));
    return c.json(rows.map(rewardToApi) satisfies Reward[]);
  });

  app.patch('/households/:householdId/rewards/:rewardId', async (c) => {
    const body = await parseBody(c, setActiveSchema);
    if (!body.ok) return body.response;
    const rewardId = c.req.param('rewardId');
    if (!z.string().uuid().safeParse(rewardId).success) {
      return c.json({ error: 'not_found' }, 404);
    }
    // The household in the WHERE is what makes "hiding affects only that household" structural:
    // another household's row is not a forbidden write, it is no row at all.
    const [row] = await db
      .update(rewards)
      .set({ active: body.data.active, updatedAt: new Date() })
      .where(and(eq(rewards.id, rewardId), eq(rewards.householdId, c.get('householdId'))))
      .returning();
    if (!row) return c.json({ error: 'not_found' }, 404);
    return c.json(rewardToApi(row) satisfies Reward);
  });

  return app;
}
