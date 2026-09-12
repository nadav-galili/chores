import {
  JOIN_CODE_TTL_MS,
  generateJoinCode,
  joinCodeRedeemed,
  joinCodeStatus,
  redeemJoinCodeInputSchema,
  uuid7,
  type IssuedJoinCode,
  type DeviceSession,
} from '@chores/shared';
import { randomInt, randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import type { Analytics } from './analytics.ts';
import type { Db } from './db/client.ts';
import { childDevices, children, households, joinCodes } from './db/schema.ts';
import {
  hashDeviceToken,
  newDeviceToken,
  requireKidDevice,
  type DeviceEnv,
} from './device-auth.ts';
import { parseBody } from './parse-body.ts';
import { rateLimit, type RateLimit } from './rate-limit.ts';
import { householdScope, type ScopedEnv } from './scope.ts';
import { childSummaryToApi, householdSummaryToApi } from './serialize.ts';

const secureRandom = () => randomInt(0, 2 ** 32) / 2 ** 32;

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

/** What a kid device is told about its child and household: first name, pet, tz and boundary. */
async function deviceContext(db: Db | Tx, childId: string, householdId: string) {
  const [child] = await db.select().from(children).where(eq(children.id, childId));
  const [household] = await db.select().from(households).where(eq(households.id, householdId));
  return { child: childSummaryToApi(child!), household: householdSummaryToApi(household!) };
}

/**
 * Claims `code` for this child unless a live code already holds it: a dead row (expired or
 * redeemed) is taken over, so codes are unique while live and the table never needs sweeping.
 */
async function claimCode(
  db: Db,
  code: string,
  values: { householdId: string; childId: string; createdBy: string; expiresAt: Date },
) {
  const [row] = await db
    .insert(joinCodes)
    .values({ code, ...values })
    .onConflictDoUpdate({
      target: joinCodes.code,
      set: { ...values, redeemedAt: null, redeemedDeviceId: null },
      where: sql`${joinCodes.expiresAt} < now() or ${joinCodes.redeemedAt} is not null`,
    })
    .returning();
  return row ?? null;
}

/** Join codes: a parent issues one per child; a kid device redeems it, publicly. */
export function joinRoutes(db: Db, redeemLimit: RateLimit, analytics: Analytics) {
  const app = new Hono();

  const scoped = new Hono<ScopedEnv>();
  scoped.use('/households/:householdId/*', householdScope(db));

  scoped.post('/households/:householdId/children/:childId/join-code', async (c) => {
    const householdId = c.get('householdId');
    const child = await db.query.children.findFirst({
      where: and(eq(children.id, c.req.param('childId')), eq(children.householdId, householdId)),
    });
    if (!child) return c.json({ error: 'not_found' }, 404);
    // A Kid Device with no way out is unreachable rather than handled: no PIN, no join code
    // (ADR-0013). The app reads `pin_required` and sends the parent to the PIN screen.
    const household = await db.query.households.findFirst({
      where: eq(households.id, householdId),
    });
    if (!household?.pinHash) return c.json({ error: 'pin_required' }, 409);

    const expiresAt = new Date(Date.now() + JOIN_CODE_TTL_MS);
    for (let attempt = 0; attempt < 5; attempt++) {
      const row = await claimCode(db, generateJoinCode(secureRandom), {
        householdId,
        childId: child.id,
        createdBy: c.get('parentId'),
        expiresAt,
      });
      if (row) {
        const issued: IssuedJoinCode = {
          code: row.code,
          child_id: row.childId,
          expires_at: row.expiresAt.toISOString(),
        };
        return c.json(issued, 201);
      }
    }
    return c.json({ error: 'code_collision' }, 503);
  });

  scoped.delete('/households/:householdId/children/:childId/devices/:deviceId', async (c) => {
    const [row] = await db
      .update(childDevices)
      .set({ revokedAt: sql`coalesce(${childDevices.revokedAt}, now())` })
      .where(
        and(
          eq(childDevices.id, c.req.param('deviceId')),
          eq(childDevices.childId, c.req.param('childId')),
          eq(childDevices.householdId, c.get('householdId')),
        ),
      )
      .returning();
    if (!row) return c.json({ error: 'not_found' }, 404);
    return c.json({ id: row.id, revoked_at: row.revokedAt!.toISOString() });
  });

  app.route('/', scoped);

  app.use('/join-codes/redeem', rateLimit(redeemLimit));
  app.post('/join-codes/redeem', async (c) => {
    const body = await parseBody(c, redeemJoinCodeInputSchema);
    if (!body.ok) return body.response;
    const token = newDeviceToken();

    const result = await db.transaction(async (tx) => {
      const [code] = await tx
        .select()
        .from(joinCodes)
        .where(eq(joinCodes.code, body.data.code))
        .for('update');
      if (!code) return { error: 'invalid_code', status: 404 as const };
      const status = joinCodeStatus(code, new Date());
      if (status === 'expired') return { error: 'code_expired', status: 410 as const };
      if (status === 'redeemed') return { error: 'code_redeemed', status: 409 as const };

      const [device] = await tx
        .insert(childDevices)
        .values({
          id: uuid7(),
          childId: code.childId,
          householdId: code.householdId,
          tokenHash: hashDeviceToken(token),
          analyticsAnonId: randomUUID(),
          platform: body.data.platform,
        })
        .returning();
      await tx
        .update(joinCodes)
        .set({ redeemedAt: new Date(), redeemedDeviceId: device!.id })
        .where(eq(joinCodes.code, code.code));
      const session: DeviceSession = {
        device_id: device!.id,
        device_token: token,
        analytics_anon_id: device!.analyticsAnonId,
        ...(await deviceContext(tx, code.childId, code.householdId)),
      };
      return { session };
    });
    if ('error' in result) return c.json({ error: result.error }, result.status);
    // The device's own anon id, used here for the first time: the join is the first thing this
    // device ever reports, and the only party it is reported as is itself (ADR-0009).
    analytics.capture({
      distinctId: result.session.analytics_anon_id,
      event: joinCodeRedeemed({
        ui_mode: result.session.child.ui_mode,
        household_id: result.session.household.id,
        platform: body.data.platform,
      }),
    });
    return c.json(result.session, 201);
  });

  const device = new Hono<DeviceEnv>();
  device.use('/device/*', requireKidDevice(db));
  device.get('/device/me', async (c) => {
    const [child] = await db
      .select()
      .from(children)
      .where(eq(children.id, c.get('childId')));
    const [household] = await db
      .select()
      .from(households)
      .where(eq(households.id, c.get('householdId')));
    return c.json({
      child: childSummaryToApi(child!),
      household: householdSummaryToApi(household!),
    });
  });
  app.route('/', device);

  return app;
}
