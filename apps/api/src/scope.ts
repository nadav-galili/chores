import { eq } from 'drizzle-orm';
import type { MiddlewareHandler } from 'hono';
import type { AuthVariables } from './auth.ts';
import type { Db } from './db/client.ts';
import { parents } from './db/schema.ts';

export type ScopedVariables = AuthVariables & { householdId: string; parentId: string };
export type ScopedEnv = { Variables: ScopedVariables };

/** Every route under `/households/:householdId` is scoped to the caller's own household; any other id is 404. */
export function householdScope(db: Db): MiddlewareHandler<ScopedEnv> {
  return async (c, next) => {
    const parent = await db.query.parents.findFirst({
      where: eq(parents.clerkUserId, c.get('clerkUserId')),
    });
    if (!parent || parent.householdId !== c.req.param('householdId')) {
      return c.json({ error: 'not_found' }, 404);
    }
    c.set('householdId', parent.householdId);
    c.set('parentId', parent.id);
    await next();
  };
}
