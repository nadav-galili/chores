import { count, eq, inArray, or, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import type { DeleteAnalyticsPersons } from './analytics.ts';
import type { AuthVariables } from './auth.ts';
import type { Db } from './db/client.ts';
import {
  appliedOps,
  changeLog,
  childDevices,
  children,
  choreAssignees,
  choreInstances,
  chores,
  completions,
  daySummaries,
  growthEntries,
  households,
  joinCodes,
  ledgerEntries,
  notifications,
  parentDevices,
  parentInvites,
  parents,
  redemptions,
  revenuecatEvents,
  rewards,
  xpEvents,
} from './db/schema.ts';
import { CLERK_API, clerkHeaders } from './review-access.ts';
import type { PurgePhotos } from './uploads.ts';

/** Removes the Clerk user for good. A user Clerk no longer has is already the outcome asked for. */
export type DeleteClerkUser = (clerkUserId: string) => Promise<void>;

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

/** One plain Backend API call, for the same reason `clerkSignInTokens` makes its own. */
export function clerkUserDeleter(
  secretKey: string,
  fetchImpl: typeof fetch = fetch,
): DeleteClerkUser {
  return async (clerkUserId) => {
    const res = await fetchImpl(`${CLERK_API}/users/${encodeURIComponent(clerkUserId)}`, {
      method: 'DELETE',
      headers: clerkHeaders(secretKey),
    });
    if (!res.ok && res.status !== 404) throw new Error(`clerk user deletion failed: ${res.status}`);
  };
}

/** One parent leaving a household a Partner still holds: their own rows go, the household's stay. */
async function deleteParent(tx: Tx, parentId: string) {
  const devices = await tx
    .select({ id: parentDevices.id })
    .from(parentDevices)
    .where(eq(parentDevices.parentId, parentId));
  await tx.delete(notifications).where(
    or(
      sql`${notifications.payload}->>'parent_id' = ${parentId}`,
      devices.length
        ? inArray(
            notifications.targetId,
            devices.map((d) => d.id),
          )
        : undefined,
    ),
  );
  await tx.delete(parentDevices).where(eq(parentDevices.parentId, parentId));
  // The accepted invite is the one row holding this parent's email address. Invites they sent
  // stay: a pending one is the household's seat, not theirs.
  await tx.delete(parentInvites).where(eq(parentInvites.acceptedParentId, parentId));
  await tx.delete(parents).where(eq(parents.id, parentId));
}

/**
 * Household Deletion (ADR-0019): every row of the household, children-first so no foreign key is
 * left pointing at a row already gone. The append-only rules of ADR-0002 and ADR-0011 govern a
 * living household's history; this is the one path that ends one.
 *
 * The `log_change` triggers write a `delete` row for each child-scoped row removed here — they
 * look the household up from `children` and `chores`, which is why those go late — and the change
 * log itself goes last, taking those rows with it.
 */
async function deleteHousehold(tx: Tx, householdId: string) {
  const ids = async <T extends { id: string }>(rows: Promise<T[]>) => (await rows).map((r) => r.id);
  const [childIds, parentIds, kidDeviceIds, choreIds] = await Promise.all([
    ids(tx.select({ id: children.id }).from(children).where(eq(children.householdId, householdId))),
    ids(tx.select({ id: parents.id }).from(parents).where(eq(parents.householdId, householdId))),
    ids(
      tx
        .select({ id: childDevices.id })
        .from(childDevices)
        .where(eq(childDevices.householdId, householdId)),
    ),
    ids(tx.select({ id: chores.id }).from(chores).where(eq(chores.householdId, householdId))),
  ]);
  const parentDeviceIds = parentIds.length
    ? await ids(
        tx
          .select({ id: parentDevices.id })
          .from(parentDevices)
          .where(inArray(parentDevices.parentId, parentIds)),
      )
    : [];
  const deviceIds = [...kidDeviceIds, ...parentDeviceIds];

  // A notification row holds ids only, but they are this household's ids.
  const aboutHousehold = [
    deviceIds.length ? inArray(notifications.targetId, deviceIds) : undefined,
    childIds.length ? inArray(sql`${notifications.payload}->>'child_id'`, childIds) : undefined,
    parentIds.length ? inArray(sql`${notifications.payload}->>'parent_id'`, parentIds) : undefined,
  ].filter((c) => c !== undefined);
  if (aboutHousehold.length) await tx.delete(notifications).where(or(...aboutHousehold));
  if (kidDeviceIds.length)
    await tx.delete(appliedOps).where(inArray(appliedOps.deviceId, kidDeviceIds));

  if (childIds.length) {
    await tx.delete(xpEvents).where(inArray(xpEvents.childId, childIds));
    await tx.delete(daySummaries).where(inArray(daySummaries.childId, childIds));
  }
  await tx.delete(ledgerEntries).where(eq(ledgerEntries.householdId, householdId));
  await tx.delete(growthEntries).where(eq(growthEntries.householdId, householdId));
  await tx.delete(redemptions).where(eq(redemptions.householdId, householdId));
  await tx.delete(rewards).where(eq(rewards.householdId, householdId));
  await tx.delete(completions).where(eq(completions.householdId, householdId));
  await tx.delete(choreInstances).where(eq(choreInstances.householdId, householdId));
  if (choreIds.length)
    await tx.delete(choreAssignees).where(inArray(choreAssignees.choreId, choreIds));
  await tx.delete(chores).where(eq(chores.householdId, householdId));
  await tx.delete(joinCodes).where(eq(joinCodes.householdId, householdId));
  await tx.delete(childDevices).where(eq(childDevices.householdId, householdId));
  await tx.delete(children).where(eq(children.householdId, householdId));
  await tx.delete(revenuecatEvents).where(eq(revenuecatEvents.householdId, householdId));
  await tx.delete(parentInvites).where(eq(parentInvites.householdId, householdId));
  if (parentIds.length)
    await tx.delete(parentDevices).where(inArray(parentDevices.parentId, parentIds));
  await tx.delete(parents).where(eq(parents.householdId, householdId));
  await tx.delete(changeLog).where(eq(changeLog.householdId, householdId));
  await tx.delete(households).where(eq(households.id, householdId));
}

/**
 * `DELETE /me`: Account Deletion for the signed-in parent, and Household Deletion when they are
 * the last one (ADR-0019). Immediate, with no grace period. A Kid Device is never a Clerk user,
 * so nothing on the kid side of the app can reach this route.
 *
 * The order is what makes a failure retryable. Photos and analytics go first, while the rows that
 * name them still exist, and a failure there deletes nothing. Analytics is deleted rather than
 * merely left behind because the page that offers this says nothing is retained: a parent's
 * events carry their Clerk id, and a kid device's its anon id (ADR-0009). Clerk goes last: a parent whose rows are
 * gone but whose Clerk user is not can sign in and delete again, and this route then finds no
 * parent row and deletes only the Clerk user.
 */
export function accountDeletionRoutes(
  db: Db,
  {
    deleteClerkUser,
    purgePhotos,
    deleteAnalyticsPersons,
  }: {
    deleteClerkUser: DeleteClerkUser | undefined;
    purgePhotos: PurgePhotos | undefined;
    deleteAnalyticsPersons: DeleteAnalyticsPersons | undefined;
  },
) {
  const app = new Hono<{ Variables: AuthVariables }>();

  app.delete('/me', async (c) => {
    if (!deleteClerkUser) return c.json({ error: 'account_deletion_unavailable' }, 503);
    const clerkUserId = c.get('clerkUserId');
    const parent = await db.query.parents.findFirst({
      where: eq(parents.clerkUserId, clerkUserId),
    });

    // The parent's own analytics person, plus — as the last parent — every kid device's.
    const distinctIds = [clerkUserId];
    let householdDeleted = false;
    if (parent) {
      const { householdId } = parent;
      const [parentCount] = await db
        .select({ n: count() })
        .from(parents)
        .where(eq(parents.householdId, householdId));
      // Read outside the transaction, so a Partner joining in the same instant can find the
      // photos already gone; a second parent deleting in that instant leaves them to the
      // bucket's own 30-day expiry (ADR-0017). Either way no row outlives the decision below.
      const last = (parentCount?.n ?? 0) <= 1;
      if (last) {
        const devices = await db
          .select({ anonId: childDevices.analyticsAnonId })
          .from(childDevices)
          .where(eq(childDevices.householdId, householdId));
        distinctIds.push(...devices.map((d) => d.anonId));
      }
      if (last && purgePhotos) {
        const childRows = await db
          .select({ id: children.id })
          .from(children)
          .where(eq(children.householdId, householdId));
        if (childRows.length) {
          try {
            await purgePhotos(childRows.map((r) => r.id));
          } catch (e) {
            // The SDK's own error can quote the request, and the request names a child's prefix:
            // the name and status say what failed without it (CODING_STANDARDS.md, child privacy).
            const status = (e as { $metadata?: { httpStatusCode?: number } }).$metadata
              ?.httpStatusCode;
            console.error('account deletion: photo purge failed', {
              name: e instanceof Error ? e.name : 'unknown',
              status,
            });
            return c.json({ error: 'photo_purge_failed' }, 503);
          }
        }
      }
    }

    if (deleteAnalyticsPersons) {
      try {
        await deleteAnalyticsPersons(distinctIds);
      } catch (e) {
        // Our own error, naming a status or a count and never an id.
        console.error('account deletion: analytics person deletion failed', e);
        return c.json({ error: 'analytics_deletion_failed' }, 503);
      }
    }

    if (parent) {
      const { householdId } = parent;

      householdDeleted = await db.transaction(async (tx) => {
        // Two parents deleting at once must not each see the other and leave a household nobody
        // can sign into: the household row is the lock both take before counting.
        await tx
          .select({ id: households.id })
          .from(households)
          .where(eq(households.id, householdId))
          .for('update');
        const [remaining] = await tx
          .select({ n: count() })
          .from(parents)
          .where(eq(parents.householdId, householdId));
        if ((remaining?.n ?? 0) > 1) {
          await deleteParent(tx, parent.id);
          return false;
        }
        await deleteHousehold(tx, householdId);
        return true;
      });
    }

    try {
      await deleteClerkUser(clerkUserId);
    } catch (e) {
      console.error('account deletion: clerk user deletion failed', e);
      return c.json({ error: 'clerk_deletion_failed' }, 502);
    }
    return c.json({ household_deleted: householdDeleted });
  });

  return app;
}
