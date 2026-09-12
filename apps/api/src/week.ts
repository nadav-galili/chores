import { choreDate, historyWindow, type ParentWeek, type ParentWeekChore } from '@chores/shared';
import { and, asc, eq, gte, lte } from 'drizzle-orm';
import { Hono } from 'hono';
import type { Db } from './db/client.ts';
import { children, choreInstances, chores, completions, households } from './db/schema.ts';
import { householdScope, type ScopedEnv } from './scope.ts';

/**
 * One child's last seven Chore Dates as chores against days, and the completion id each done
 * cell carries. Without this a parent cannot reach a completion from an earlier day at all, so
 * the Redo Window barely opens: the Digest that prompts a rejection arrives at 20:00 and the
 * parent acts the next morning.
 *
 * Ungated on purpose. Seven days of history is what the free tier promises (docs/spec/01-product.md,
 * Tiers), so nothing here consults `households.entitlement`; M3's `full_history` gate extends the
 * same window backwards rather than opening it.
 *
 * Read-only, unlike the today screen: `writeHouseholdInstances` is never called for a past date,
 * because materializing history after the fact would invent instances for days a chore was not
 * active on (ADR-0003 — instances are written when the day arrives, not derived on read).
 */
export function weekRoutes(db: Db) {
  const app = new Hono<ScopedEnv>();
  app.use('/households/:householdId/children/:childId/week', householdScope(db));

  app.get('/households/:householdId/children/:childId/week', async (c) => {
    const householdId = c.get('householdId');
    // The child is looked up inside the household: an id from another family is not found here.
    const child = await db.query.children.findFirst({
      where: and(eq(children.id, c.req.param('childId')), eq(children.householdId, householdId)),
    });
    if (!child) return c.json({ error: 'not_found' }, 404);
    const household = await db.query.households.findFirst({
      where: eq(households.id, householdId),
    });
    if (!household) return c.json({ error: 'not_found' }, 404);

    // Household-local, and ending on the household's today — never the server's UTC date.
    const today = choreDate(new Date(), household.tz, household.dayBoundaryHour);
    const dates = historyWindow(today);
    const from = dates[0]!;

    const [instanceRows, completionRows] = await Promise.all([
      // The rows are driven by the instances, not by the chores, so a chore with nothing in the
      // window simply has no row — including one that was never due in it and one now deleted.
      db
        .select({
          id: choreInstances.id,
          choreId: choreInstances.choreId,
          choreDate: choreInstances.choreDate,
          status: choreInstances.status,
          title: chores.title,
          icon: chores.icon,
        })
        .from(choreInstances)
        .innerJoin(chores, eq(chores.id, choreInstances.choreId))
        .where(
          and(
            eq(choreInstances.childId, child.id),
            eq(choreInstances.householdId, householdId),
            gte(choreInstances.choreDate, from),
            lte(choreInstances.choreDate, today),
          ),
        )
        .orderBy(asc(chores.title), asc(choreInstances.choreDate)),
      db
        .select({
          id: completions.id,
          instanceId: completions.instanceId,
        })
        .from(completions)
        .where(
          and(
            eq(completions.childId, child.id),
            eq(completions.householdId, householdId),
            eq(completions.status, 'accepted'),
            gte(completions.choreDate, from),
            lte(completions.choreDate, today),
          ),
        )
        // An instance can hold more than one accepted completion — a child with two devices,
        // both offline, taps it twice; or one rejected and redone — and the map below keeps the
        // last row it reads. Oldest first makes that the newest completion: the one still holding
        // the instance up, and so the one a parent rejecting from this cell means.
        .orderBy(asc(completions.completedAt)),
    ]);

    const doneBy = new Map(completionRows.map((r) => [r.instanceId, r.id]));
    const byChore = new Map<string, ParentWeekChore>();
    for (const row of instanceRows) {
      let chore = byChore.get(row.choreId);
      if (!chore) {
        chore = { chore_id: row.choreId, title: row.title, icon: row.icon, cells: [] };
        byChore.set(row.choreId, chore);
      }
      chore.cells.push({
        instance_id: row.id,
        chore_date: row.choreDate,
        status: row.status,
        completion_id: doneBy.get(row.id) ?? null,
      });
    }

    const body: ParentWeek = {
      child_id: child.id,
      chore_dates: dates,
      chores: [...byChore.values()],
    };
    return c.json(body);
  });

  return app;
}
