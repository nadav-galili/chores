import { customRewardInputSchema, writerClockSchema, type Reward } from '@chores/shared';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import type { Db } from './db/client.ts';
import { rewards } from './db/schema.ts';
import { gate } from './gate.ts';
import { parseBody } from './parse-body.ts';
import { householdScope, type ScopedEnv } from './scope.ts';
import { rewardToApi } from './serialize.ts';

const setActiveSchema = z.object({ active: z.boolean() });
const deleteCustomRewardSchema = z.object({ updated_at: writerClockSchema });

/**
 * The household's reward catalog, as the parent sees it. The free tier ships the built-ins and
 * lets a parent hide the ones they are not willing to give: hiding is `active = false` on the
 * household's own copied row, which is the whole reason the catalog is per household rather than
 * shared. The `rewards` change-log trigger carries the flip to every Kid Device on its next pull.
 *
 * Custom writes hit the server gate immediately before the write. Listing, and changing a
 * built-in's visibility, stay part of the free catalog.
 */
export function rewardRoutes(db: Db) {
  const app = new Hono<ScopedEnv>();
  app.use('/households/:householdId/rewards', householdScope(db));
  app.use('/households/:householdId/rewards/*', householdScope(db));

  app.get('/households/:householdId/rewards', async (c) => {
    const rows = await db
      .select()
      .from(rewards)
      .where(and(eq(rewards.householdId, c.get('householdId')), isNull(rewards.deletedAt)))
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
    const [existing] = await db
      .select()
      .from(rewards)
      .where(and(eq(rewards.id, rewardId), eq(rewards.householdId, c.get('householdId'))));
    if (!existing || existing.deletedAt) return c.json({ error: 'not_found' }, 404);
    if (!existing.isBuiltin) {
      const answer = await gate(db, 'custom_reward', {
        householdId: c.get('householdId'),
        now: new Date().toISOString(),
        child_count: 0,
        parent_count: 0,
      });
      if (answer instanceof Response) return answer;
    }
    // The household in the WHERE makes another household's row unreachable by construction.
    const [row] = await db
      .update(rewards)
      .set({ active: body.data.active, updatedAt: new Date() })
      .where(and(eq(rewards.id, rewardId), eq(rewards.householdId, c.get('householdId'))))
      .returning();
    if (!row) return c.json({ error: 'not_found' }, 404);
    return c.json(rewardToApi(row) satisfies Reward);
  });

  /** Create or replace one parent-authored catalog row. A built-in can never enter this path. */
  app.put('/households/:householdId/rewards/:rewardId', async (c) => {
    const householdId = c.get('householdId');
    const answer = await gate(db, 'custom_reward', {
      householdId,
      now: new Date().toISOString(),
      child_count: 0,
      parent_count: 0,
    });
    if (answer instanceof Response) return answer;
    const body = await parseBody(c, customRewardInputSchema);
    if (!body.ok) return body.response;
    const rewardId = c.req.param('rewardId');
    if (!z.string().uuid().safeParse(rewardId).success) {
      return c.json({ error: 'not_found' }, 404);
    }

    const result = await db.transaction(async (tx) => {
      const [existing] = await tx
        .select()
        .from(rewards)
        .where(eq(rewards.id, rewardId))
        .for('update');
      if (existing && existing.householdId !== householdId) return { status: 404 as const };
      if (existing?.isBuiltin) return { status: 400 as const };
      const values = {
        title: body.data.title,
        icon: body.data.icon,
        costCoins: body.data.cost_coins,
        active: body.data.active,
        sort: body.data.sort,
        updatedAt: new Date(body.data.updated_at),
        deletedAt: null,
      };
      if (existing) {
        const [row] = await tx
          .update(rewards)
          .set(values)
          .where(eq(rewards.id, rewardId))
          .returning();
        return { status: 200 as const, row: row! };
      }
      const [row] = await tx
        .insert(rewards)
        .values({
          ...values,
          id: rewardId,
          householdId,
          builtinKey: null,
          isBuiltin: false,
        })
        .returning();
      return { status: 201 as const, row: row! };
    });

    if (!('row' in result)) {
      return c.json(
        { error: result.status === 404 ? 'not_found' : 'builtin_reward' },
        result.status,
      );
    }
    return c.json(rewardToApi(result.row) satisfies Reward, result.status);
  });

  /** Soft-delete only: a Redemption keeps its foreign key and snapshotted cost indefinitely. */
  app.delete('/households/:householdId/rewards/:rewardId', async (c) => {
    const householdId = c.get('householdId');
    const answer = await gate(db, 'custom_reward', {
      householdId,
      now: new Date().toISOString(),
      child_count: 0,
      parent_count: 0,
    });
    if (answer instanceof Response) return answer;
    const body = await parseBody(c, deleteCustomRewardSchema);
    if (!body.ok) return body.response;
    const rewardId = c.req.param('rewardId');
    if (!z.string().uuid().safeParse(rewardId).success) {
      return c.json({ error: 'not_found' }, 404);
    }

    const [existing] = await db
      .select()
      .from(rewards)
      .where(and(eq(rewards.id, rewardId), eq(rewards.householdId, householdId)));
    if (!existing) return c.json({ error: 'not_found' }, 404);
    if (existing.isBuiltin) return c.json({ error: 'builtin_reward' }, 400);
    if (existing.deletedAt) return c.json(rewardToApi(existing) satisfies Reward);
    const [row] = await db
      .update(rewards)
      .set({ deletedAt: new Date(body.data.updated_at), updatedAt: new Date(body.data.updated_at) })
      .where(eq(rewards.id, rewardId))
      .returning();
    return c.json(rewardToApi(row!) satisfies Reward);
  });

  return app;
}
