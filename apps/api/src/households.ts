import { childInputSchema, createHouseholdInputSchema, uuid7 } from '@chores/shared';
import { and, asc, eq, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import type { AuthVariables } from './auth.ts';
import type { Db } from './db/client.ts';
import { children, households, parents } from './db/schema.ts';
import { childToApi, householdToApi, parentToApi } from './serialize.ts';
import { parseBody } from './parse-body.ts';
import { householdScope, type ScopedEnv } from './scope.ts';

type Env = { Variables: AuthVariables };

/** Routes for a signed-in parent: their household and its children. */
export function householdRoutes(db: Db) {
  const app = new Hono<Env>();

  const parentOf = (clerkUserId: string) =>
    db.query.parents.findFirst({ where: eq(parents.clerkUserId, clerkUserId) });

  const listChildren = (householdId: string) =>
    db.query.children.findMany({
      where: eq(children.householdId, householdId),
      orderBy: asc(children.sort),
    });

  app.get('/me', async (c) => {
    const parent = await parentOf(c.get('clerkUserId'));
    if (!parent) return c.json({ parent: null, household: null, children: [] });
    const [household, childRows] = await Promise.all([
      db.query.households.findFirst({ where: eq(households.id, parent.householdId) }),
      listChildren(parent.householdId),
    ]);
    if (!household) return c.json({ error: 'household_missing' }, 500);
    return c.json({
      parent: parentToApi(parent),
      household: householdToApi(household),
      children: childRows.map(childToApi),
    });
  });

  app.post('/households', async (c) => {
    const body = await parseBody(c, createHouseholdInputSchema);
    if (!body.ok) return body.response;
    const clerkUserId = c.get('clerkUserId');
    if (await parentOf(clerkUserId)) return c.json({ error: 'already_in_household' }, 409);

    const result = await db.transaction(async (tx) => {
      const [household] = await tx
        .insert(households)
        .values({
          id: uuid7(),
          name: body.data.name,
          tz: body.data.tz,
          currency: body.data.currency,
        })
        .returning();
      const [parent] = await tx
        .insert(parents)
        .values({
          id: uuid7(),
          householdId: household!.id,
          clerkUserId,
        })
        .returning();
      return { household: household!, parent: parent! };
    });
    return c.json(
      { household: householdToApi(result.household), parent: parentToApi(result.parent) },
      201,
    );
  });

  const scoped = new Hono<ScopedEnv>();
  scoped.use('/households/:householdId/*', householdScope(db));

  scoped.get('/households/:householdId/children', async (c) => {
    return c.json((await listChildren(c.get('householdId'))).map(childToApi));
  });

  scoped.post('/households/:householdId/children', async (c) => {
    const body = await parseBody(c, childInputSchema);
    if (!body.ok) return body.response;
    const householdId = c.get('householdId');
    const [row] = await db
      .insert(children)
      .values({
        id: uuid7(),
        householdId,
        firstName: body.data.first_name,
        uiMode: body.data.ui_mode,
        petName: body.data.pet_name,
        reminderTime: body.data.reminder_time,
        sort: sql`(select coalesce(max(${children.sort}) + 1, 0) from ${children} where ${children.householdId} = ${householdId})`,
      })
      .returning();
    return c.json(childToApi(row!), 201);
  });

  scoped.patch('/households/:householdId/children/:childId', async (c) => {
    const body = await parseBody(c, childInputSchema);
    if (!body.ok) return body.response;
    const [row] = await db
      .update(children)
      .set({
        firstName: body.data.first_name,
        uiMode: body.data.ui_mode,
        petName: body.data.pet_name,
        reminderTime: body.data.reminder_time,
      })
      .where(
        and(
          eq(children.id, c.req.param('childId')),
          eq(children.householdId, c.get('householdId')),
        ),
      )
      .returning();
    if (!row) return c.json({ error: 'not_found' }, 404);
    return c.json(childToApi(row));
  });

  app.route('/', scoped);
  return app;
}
