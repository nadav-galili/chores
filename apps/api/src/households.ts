import {
  builtinRewardsFor,
  canDo,
  childInputSchema,
  createHouseholdInputSchema,
  householdCreated,
  parentDeviceId,
  parentDeviceInputSchema,
  parentInviteInputSchema,
  uuid7,
} from '@chores/shared';
import { and, asc, count, eq, isNull, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import type { Analytics } from './analytics.ts';
import type { AuthVariables } from './auth.ts';
import type { Db } from './db/client.ts';
import {
  children,
  households,
  parentDevices,
  parentInvites,
  parents,
  rewards,
} from './db/schema.ts';
import {
  childToApi,
  householdToApi,
  parentDeviceToApi,
  parentInviteToApi,
  parentToApi,
} from './serialize.ts';
import { parseBody } from './parse-body.ts';
import { householdScope, type ScopedEnv } from './scope.ts';

type Env = { Variables: AuthVariables };

/** Routes for a signed-in parent: their household and its children. */
export function householdRoutes(db: Db, analytics: Analytics) {
  const app = new Hono<Env>();

  const parentOf = (clerkUserId: string) =>
    db.query.parents.findFirst({ where: eq(parents.clerkUserId, clerkUserId) });

  /**
   * A partner invited by email becomes a parent on their first sign-in with that address: there is
   * no invite link to click, so the pending invite is what places them in the household.
   */
  const claimInvite = async (clerkUserId: string, email: string | null) => {
    if (!email) return undefined;
    const normalized = email.trim().toLowerCase();
    return db.transaction(async (tx) => {
      const invite = await tx.query.parentInvites.findFirst({
        where: and(eq(parentInvites.email, normalized), isNull(parentInvites.acceptedAt)),
      });
      if (!invite) return undefined;
      const [parent] = await tx
        .insert(parents)
        .values({
          id: uuid7(),
          householdId: invite.householdId,
          clerkUserId,
          email: normalized,
        })
        .returning();
      await tx
        .update(parentInvites)
        .set({ acceptedAt: new Date(), acceptedParentId: parent!.id })
        .where(eq(parentInvites.email, normalized));
      return parent!;
    });
  };

  const listChildren = (householdId: string) =>
    db.query.children.findMany({
      where: eq(children.householdId, householdId),
      orderBy: asc(children.sort),
    });

  app.get('/me', async (c) => {
    const clerkUserId = c.get('clerkUserId');
    const parent =
      (await parentOf(clerkUserId)) ?? (await claimInvite(clerkUserId, c.get('email')));
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
    const email = c.get('email')?.trim().toLowerCase() ?? null;

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
          email,
        })
        .returning();
      // The built-in catalog is copied in here rather than existing globally: a row with no
      // household has no path into a `change_log` scoped by one (docs/spec/02-data-model.md).
      // Each row carries its `builtin_key` and no title — the device renders that from i18n.
      await tx
        .insert(rewards)
        .values(
          builtinRewardsFor(household!.id, household!.createdAt.toISOString()).map((r) => ({
            id: r.id,
            householdId: r.household_id,
            builtinKey: r.builtin_key,
            title: r.title,
            icon: r.icon,
            costCoins: r.cost_coins,
            isBuiltin: r.is_builtin,
            active: r.active,
            sort: r.sort,
            updatedAt: new Date(r.updated_at),
          })),
        )
        // Reward ids are deterministic (ADR-0010), so a retried creation seeds the same three rows
        // rather than giving the household a second snack.
        .onConflictDoNothing();
      return { household: household!, parent: parent! };
    });
    analytics.capture({
      distinctId: clerkUserId,
      event: householdCreated({ currency: result.household.currency, tz: result.household.tz }),
      groups: { household: result.household.id },
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

  scoped.get('/households/:householdId/parents', async (c) => {
    const householdId = c.get('householdId');
    const [parentRows, inviteRows] = await Promise.all([
      db.query.parents.findMany({
        where: eq(parents.householdId, householdId),
        orderBy: asc(parents.createdAt),
      }),
      db.query.parentInvites.findMany({
        where: eq(parentInvites.householdId, householdId),
        orderBy: asc(parentInvites.createdAt),
      }),
    ]);
    return c.json({
      parents: parentRows.map(parentToApi),
      invites: inviteRows.map(parentInviteToApi),
    });
  });

  /**
   * Invite a partner by email. The seat is taken the moment the invite is written, so a pending
   * invite counts against the free tier's two parents just as a signed-in one does.
   */
  scoped.post('/households/:householdId/parents', async (c) => {
    const body = await parseBody(c, parentInviteInputSchema);
    if (!body.ok) return body.response;
    const { email } = body.data;
    const householdId = c.get('householdId');

    const household = await db.query.households.findFirst({
      where: eq(households.id, householdId),
    });
    if (!household) return c.json({ error: 'not_found' }, 404);

    const existing = await db.query.parentInvites.findFirst({
      where: eq(parentInvites.email, email),
    });
    // Re-inviting the same address is the same seat, not a second one.
    if (existing) {
      return existing.householdId === householdId
        ? c.json(parentInviteToApi(existing), 201)
        : c.json({ error: 'already_in_household' }, 409);
    }
    if (await db.query.parents.findFirst({ where: eq(parents.email, email) })) {
      return c.json({ error: 'already_in_household' }, 409);
    }

    const [parentCount, pendingCount] = await Promise.all([
      db.select({ n: count() }).from(parents).where(eq(parents.householdId, householdId)),
      db
        .select({ n: count() })
        .from(parentInvites)
        .where(and(eq(parentInvites.householdId, householdId), isNull(parentInvites.acceptedAt))),
    ]);
    const gate = canDo(household, 'add_parent', {
      now: new Date().toISOString(),
      child_count: 0,
      parent_count: (parentCount[0]?.n ?? 0) + (pendingCount[0]?.n ?? 0),
    });
    if (!gate.ok) return c.json({ error: 'gated', gate: gate.gate }, 402);

    const [row] = await db
      .insert(parentInvites)
      .values({ email, householdId, invitedBy: c.get('parentId') })
      .returning();
    return c.json(parentInviteToApi(row!), 201);
  });

  /**
   * This parent's phone registering for push, on every app open: a token rots, and the language
   * the phone reads can change between opens. The id is derived from the parent and the token
   * (ADR-0010), so re-registering is the same row rather than a second phone.
   */
  scoped.post('/households/:householdId/devices', async (c) => {
    const body = await parseBody(c, parentDeviceInputSchema);
    if (!body.ok) return body.response;
    const parentId = c.get('parentId');
    const { expo_push_token, platform, locale } = body.data;
    const [row] = await db
      .insert(parentDevices)
      .values({
        id: parentDeviceId(parentId, expo_push_token),
        parentId,
        expoPushToken: expo_push_token,
        platform,
        locale,
      })
      .onConflictDoUpdate({
        target: parentDevices.id,
        // The token is the id's own input, so only what can differ between opens is written —
        // plus the last seen, which is what says this phone is still the one to push to.
        set: { platform, locale, expoPushToken: expo_push_token, lastSeenAt: new Date() },
      })
      .returning();
    return c.json(parentDeviceToApi(row!), 201);
  });

  app.route('/', scoped);
  return app;
}
