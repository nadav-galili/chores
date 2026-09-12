import {
  choreDate,
  currentStreak,
  type DaySummary,
  type IsoDate,
  type ParentToday,
  type ParentTodayItem,
  type ParentTodayRedemption,
} from '@chores/shared';
import { and, asc, desc, eq, inArray, lt, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import type { Db } from './db/client.ts';
import {
  children,
  choreInstances,
  chores,
  completions,
  daySummaries,
  households,
  ledgerEntries,
  redemptions,
  rewards,
} from './db/schema.ts';
import { writeHouseholdInstances } from './materialize.ts';
import { householdScope, type ScopedEnv } from './scope.ts';

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
    await writeHouseholdInstances(db, householdId, today);

    const childRows = await db.query.children.findMany({
      where: eq(children.householdId, householdId),
      orderBy: asc(children.sort),
    });
    const childIds = childRows.map((r) => r.id);
    if (!childIds.length) {
      return c.json({ chore_date: today, children: [], redemptions: [] } satisfies ParentToday);
    }

    const [instanceRows, completionRows, balanceRows, summariesByChild, asked] = await Promise.all([
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
        .select({
          id: completions.id,
          instanceId: completions.instanceId,
          completedAt: completions.completedAt,
        })
        .from(completions)
        .where(
          and(
            inArray(completions.childId, childIds),
            eq(completions.choreDate, today),
            eq(completions.status, 'accepted'),
          ),
        )
        // An instance can hold more than one accepted completion — a child with two devices,
        // both offline, taps it twice — and the map below keeps the last row it reads. Oldest
        // first makes that the newest completion: the one still holding the instance up, and so
        // the one a parent rejecting from this screen means.
        .orderBy(asc(completions.completedAt)),
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
      // Every Redemption nobody has decided, whatever day it was asked for: a request does not
      // expire with the chore date, and a parent who was away decides yesterday's today.
      db
        .select({
          id: redemptions.id,
          childId: redemptions.childId,
          firstName: children.firstName,
          rewardId: redemptions.rewardId,
          builtinKey: rewards.builtinKey,
          title: rewards.title,
          icon: rewards.icon,
          costCoins: redemptions.costCoins,
          requestedAt: redemptions.requestedAt,
        })
        .from(redemptions)
        .innerJoin(rewards, eq(rewards.id, redemptions.rewardId))
        .innerJoin(children, eq(children.id, redemptions.childId))
        .where(and(eq(redemptions.householdId, householdId), eq(redemptions.status, 'requested')))
        .orderBy(asc(redemptions.requestedAt)),
    ]);

    const doneBy = new Map(completionRows.map((r) => [r.instanceId, r]));
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
            completed_at: doneBy.get(i.id)?.completedAt.toISOString() ?? null,
            completion_id: doneBy.get(i.id)?.id ?? null,
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
      redemptions: asked.map((r): ParentTodayRedemption => ({
        redemption_id: r.id,
        child_id: r.childId,
        first_name: r.firstName,
        reward_id: r.rewardId,
        builtin_key: r.builtinKey,
        // A built-in reward carries no title of its own; the app renders it from `builtin_key`.
        title: r.title,
        icon: r.icon,
        // The snapshot taken when the child asked, not what the catalog says today.
        cost_coins: r.costCoins,
        requested_at: r.requestedAt.toISOString(),
      })),
    };
    return c.json(body);
  });

  return app;
}
