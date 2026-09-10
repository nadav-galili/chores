import {
  choreDate,
  currentStreak,
  type DaySummary,
  type IsoDate,
  type MaterializableChore,
  type ParentToday,
  type ParentTodayItem,
} from '@chores/shared';
import { and, asc, desc, eq, inArray, lt, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import type { Db } from './db/client.ts';
import {
  children,
  choreAssignees,
  choreInstances,
  chores,
  completions,
  daySummaries,
  households,
  ledgerEntries,
} from './db/schema.ts';
import { materializable, writeInstances } from './materialize.ts';
import { householdScope, type ScopedEnv } from './scope.ts';

/**
 * The instances the whole household is due on `date`, created if missing. The parent's screen is
 * the one place a day can be seen before any kid device has opened it, so it materializes the way
 * a kid pull does (ADR-0003).
 */
async function materializeHousehold(db: Db, householdId: string, date: IsoDate) {
  const rows = await db
    .select()
    .from(chores)
    .innerJoin(choreAssignees, eq(choreAssignees.choreId, chores.id))
    .where(eq(chores.householdId, householdId));

  const byChore = new Map<string, MaterializableChore>();
  for (const { chores: chore, chore_assignees: link } of rows) {
    const held = byChore.get(chore.id);
    if (held) held.assignees.push(link.childId);
    else byChore.set(chore.id, materializable(chore, [link.childId]));
  }
  await writeInstances(db, [...byChore.values()], date);
}

/**
 * The day summaries `currentStreak` reads: today's, and the latest one before it per child. A
 * child's history grows without bound and this endpoint is polled every 60 s, so it never reads
 * the whole of it — the stored `streak_after` of the last day already carries the walk-back.
 */
async function streakSummaries(db: Db, childIds: string[], today: IsoDate) {
  const columns = {
    childId: daySummaries.childId,
    choreDate: daySummaries.choreDate,
    dueCount: daySummaries.dueCount,
    doneCount: daySummaries.doneCount,
    complete: daySummaries.complete,
    streakAfter: daySummaries.streakAfter,
  };
  const [todays, latestBefore] = await Promise.all([
    db
      .select(columns)
      .from(daySummaries)
      .where(and(inArray(daySummaries.childId, childIds), eq(daySummaries.choreDate, today))),
    db
      .selectDistinctOn([daySummaries.childId], columns)
      .from(daySummaries)
      .where(and(inArray(daySummaries.childId, childIds), lt(daySummaries.choreDate, today)))
      .orderBy(asc(daySummaries.childId), desc(daySummaries.choreDate)),
  ]);

  const byChild = new Map<string, DaySummary[]>();
  for (const row of [...latestBefore, ...todays]) {
    const held = byChild.get(row.childId) ?? [];
    held.push({
      child_id: row.childId,
      chore_date: row.choreDate,
      due_count: row.dueCount,
      done_count: row.doneCount,
      complete: row.complete,
      streak_after: row.streakAfter,
    });
    byChild.set(row.childId, held);
  }
  return byChild;
}

/** The parent's read-only view of today: what each child is due, what they did and what it paid. */
export function todayRoutes(db: Db) {
  const app = new Hono<ScopedEnv>();
  app.use('/households/:householdId/today', householdScope(db));

  app.get('/households/:householdId/today', async (c) => {
    const householdId = c.get('householdId');
    const household = await db.query.households.findFirst({
      where: eq(households.id, householdId),
    });
    if (!household) return c.json({ error: 'not_found' }, 404);
    const today = choreDate(new Date(), household.tz, household.dayBoundaryHour);
    await materializeHousehold(db, householdId, today);

    const childRows = await db.query.children.findMany({
      where: eq(children.householdId, householdId),
      orderBy: asc(children.sort),
    });
    const childIds = childRows.map((r) => r.id);
    if (!childIds.length) return c.json({ chore_date: today, children: [] } satisfies ParentToday);

    const [instanceRows, completionRows, balanceRows, summariesByChild] = await Promise.all([
      db
        .select({
          id: choreInstances.id,
          choreId: choreInstances.choreId,
          childId: choreInstances.childId,
          status: choreInstances.status,
          title: chores.title,
          icon: chores.icon,
        })
        .from(choreInstances)
        .innerJoin(chores, eq(chores.id, choreInstances.choreId))
        .where(
          and(
            inArray(choreInstances.childId, childIds),
            eq(choreInstances.choreDate, today),
            eq(choreInstances.householdId, householdId),
          ),
        )
        .orderBy(asc(chores.title)),
      db
        .select({ instanceId: completions.instanceId, completedAt: completions.completedAt })
        .from(completions)
        .where(
          and(
            inArray(completions.childId, childIds),
            eq(completions.choreDate, today),
            eq(completions.status, 'accepted'),
          ),
        ),
      // Balance is always SUM(coins) over the whole ledger; never a stored column (ADR-0002).
      db
        .select({
          childId: ledgerEntries.childId,
          coins: sql<number>`coalesce(sum(${ledgerEntries.coins}), 0)::int`,
        })
        .from(ledgerEntries)
        .where(inArray(ledgerEntries.childId, childIds))
        .groupBy(ledgerEntries.childId),
      streakSummaries(db, childIds, today),
    ]);

    const doneAt = new Map(completionRows.map((r) => [r.instanceId, r.completedAt.toISOString()]));
    const balanceByChild = new Map(balanceRows.map((r) => [r.childId, r.coins]));

    const body: ParentToday = {
      chore_date: today,
      children: childRows.map((child) => {
        const items: ParentTodayItem[] = instanceRows
          .filter((i) => i.childId === child.id)
          .map((i) => ({
            instance_id: i.id,
            chore_id: i.choreId,
            title: i.title,
            icon: i.icon,
            status: i.status,
            completed_at: doneAt.get(i.id) ?? null,
          }));
        return {
          child_id: child.id,
          first_name: child.firstName,
          items,
          due_count: items.length,
          // The instance status is what counts as done: a photo still awaiting a parent, or a
          // completion a parent rejected, has an instant but is not done.
          done_count: items.filter((i) => i.status === 'done').length,
          balance: balanceByChild.get(child.id) ?? 0,
          streak: currentStreak(summariesByChild.get(child.id) ?? [], today),
        };
      }),
    };
    return c.json(body);
  });

  return app;
}
