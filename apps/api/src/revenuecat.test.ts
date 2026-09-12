import { createHmac } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { recordingAnalytics } from './analytics.ts';
import { createApp } from './app.ts';
import type { Db } from './db/client.ts';
import { households, parents, revenuecatEvents } from './db/schema.ts';
import { asParent, fakeVerifyToken } from './test/auth.ts';
import { freshDb } from './test/db.ts';

const SECRET = 'rcwhsec_test_only';
const PRODUCT = 'mibo_yearly';

let db: Db;
let analytics: ReturnType<typeof recordingAnalytics>;
let app: ReturnType<typeof createApp>;

beforeAll(async () => {
  db = await freshDb();
});

beforeEach(() => {
  analytics = recordingAnalytics();
  app = createApp(db, {
    verifyToken: fakeVerifyToken,
    analytics,
    revenuecatWebhookSigningSecret: SECRET,
  });
});

async function household(clerkUserId: string) {
  const response = await app.request(
    '/households',
    asParent(clerkUserId, {
      method: 'POST',
      body: JSON.stringify({ name: 'Galili', tz: 'Asia/Jerusalem', currency: 'ILS' }),
    }),
  );
  const created = (await response.json()) as {
    household: { id: string };
    parent: { id: string };
  };
  return created;
}

function payload(
  id: string,
  type: string,
  appUserId: string,
  overrides: Record<string, unknown> = {},
) {
  return {
    api_version: '1.0',
    event: {
      id,
      type,
      event_timestamp_ms: Date.now(),
      app_user_id: appUserId,
      original_app_user_id: appUserId,
      aliases: [],
      product_id: PRODUCT,
      purchased_at_ms: Date.now(),
      expiration_at_ms: Date.now() + 30 * 24 * 60 * 60 * 1000,
      entitlement_ids: ['premium'],
      environment: 'SANDBOX',
      ...overrides,
    },
  };
}

function signed(body: string, secret = SECRET, timestamp = Math.floor(Date.now() / 1000)) {
  const digest = createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
  return {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-revenuecat-webhook-signature': `t=${timestamp},v1=${digest}`,
    },
    body,
  } satisfies RequestInit;
}

async function deliver(event: ReturnType<typeof payload>, init?: RequestInit) {
  const body = JSON.stringify(event);
  return app.request('/webhooks/revenuecat', init ?? signed(body));
}

async function entitlement(id: string) {
  return db.query.households.findFirst({ where: eq(households.id, id) });
}

describe('POST /webhooks/revenuecat', () => {
  it('persists the exact signed payload and applies a purchase only once', async () => {
    const owner = 'user_rc_owner';
    const { household: created } = await household(owner);
    const event = payload('rc-initial-once', 'INITIAL_PURCHASE', owner);

    expect((await deliver(event)).status).toBe(200);
    expect((await deliver(event)).status).toBe(200);

    expect(await entitlement(created.id)).toMatchObject({
      entitlement: 'premium',
      entitlementSource: `revenuecat:${PRODUCT}`,
    });
    expect(await db.select().from(revenuecatEvents)).toEqual([
      expect.objectContaining({
        eventId: 'rc-initial-once',
        householdId: created.id,
        type: 'INITIAL_PURCHASE',
        payload: event,
      }),
    ]);
    expect(analytics.sent.filter(({ event }) => event.event === 'purchase_completed')).toEqual([
      {
        distinctId: owner,
        event: {
          event: 'purchase_completed',
          properties: { product_id: PRODUCT, purchase_kind: 'subscription' },
        },
        groups: { household: created.id },
      },
    ]);
  });

  it.each([
    ['RENEWAL', {}],
    ['CANCELLATION', {}],
    ['PRODUCT_CHANGE', { new_product_id: 'mibo_monthly' }],
    ['NON_RENEWING_PURCHASE', { expiration_at_ms: Date.now() + 86_400_000 }],
  ])('%s preserves premium and records the current product', async (type, overrides) => {
    const owner = `user_rc_${type.toLowerCase()}`;
    const { household: created } = await household(owner);

    expect((await deliver(payload(`rc-${type}`, type, owner, overrides))).status).toBe(200);
    expect(await entitlement(created.id)).toMatchObject({
      entitlement: 'premium',
      entitlementSource: `revenuecat:${type === 'PRODUCT_CHANGE' ? 'mibo_monthly' : PRODUCT}`,
    });
  });

  it('returns an expired subscription household to free', async () => {
    const owner = 'user_rc_expire';
    const { household: created } = await household(owner);
    await deliver(payload('rc-before-expire', 'INITIAL_PURCHASE', owner));

    expect((await deliver(payload('rc-expire', 'EXPIRATION', owner))).status).toBe(200);
    expect(await entitlement(created.id)).toMatchObject({
      entitlement: 'free',
      entitlementSource: `revenuecat:${PRODUCT}`,
    });
  });

  it('keeps a lifetime purchase premium when a later subscription expires', async () => {
    const owner = 'user_rc_lifetime';
    const { household: created } = await household(owner);
    await deliver(
      payload('rc-lifetime', 'NON_RENEWING_PURCHASE', owner, { expiration_at_ms: null }),
    );

    await deliver(payload('rc-old-sub-expire', 'EXPIRATION', owner));
    expect(await entitlement(created.id)).toMatchObject({
      entitlement: 'premium',
      entitlementSource: `revenuecat:lifetime:${PRODUCT}`,
    });
    expect(analytics.sent.filter(({ event }) => event.event === 'purchase_completed')).toHaveLength(
      1,
    );
  });

  it('revokes a lifetime purchase only when RevenueCat cancels or refunds that no-expiry product', async () => {
    const owner = 'user_rc_lifetime_refund';
    const { household: created } = await household(owner);
    await deliver(
      payload('rc-lifetime-before-refund', 'NON_RENEWING_PURCHASE', owner, {
        expiration_at_ms: null,
      }),
    );

    await deliver(
      payload('rc-lifetime-refund', 'CANCELLATION', owner, {
        expiration_at_ms: null,
        cancel_reason: 'CUSTOMER_SUPPORT',
      }),
    );
    expect(await entitlement(created.id)).toMatchObject({
      entitlement: 'free',
      entitlementSource: `revenuecat:${PRODUCT}`,
    });
  });

  it('updates the household so its other parent sees premium without buying', async () => {
    const owner = 'user_rc_household_owner';
    const partner = 'user_rc_household_partner';
    const { household: created } = await household(owner);
    await db.insert(parents).values({
      id: '01993d7b-82f1-7000-8000-000000000001',
      householdId: created.id,
      clerkUserId: partner,
    });

    await deliver(payload('rc-shared', 'INITIAL_PURCHASE', owner));
    const me = await app.request('/me', asParent(partner));
    expect(await me.json()).toMatchObject({
      household: { id: created.id, entitlement: 'premium' },
    });
  });

  it('resolves RevenueCat aliases to the purchasing parent', async () => {
    const owner = 'user_rc_alias_owner';
    const { household: created } = await household(owner);
    await deliver(
      payload('rc-alias', 'RENEWAL', '$RCAnonymousID:old-device', {
        original_app_user_id: '$RCAnonymousID:old-device',
        aliases: [owner],
      }),
    );
    expect((await entitlement(created.id))?.entitlement).toBe('premium');
  });

  it('refuses and logs a bad signature before writing anything', async () => {
    const owner = 'user_rc_bad_signature';
    await household(owner);
    const event = payload('rc-bad-signature', 'INITIAL_PURCHASE', owner);
    const body = JSON.stringify(event);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    expect(
      (
        await deliver(event, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body,
        })
      ).status,
    ).toBe(401);
    expect((await deliver(event, signed(body, 'wrong-secret'))).status).toBe(401);
    expect(warn).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenLastCalledWith('RevenueCat webhook signature verification failed');
    expect(
      await db.execute(sql`select id from revenuecat_events where id = 'rc-bad-signature'`),
    ).toHaveLength(0);
    warn.mockRestore();
  });

  it('records but does not grant an event for another RevenueCat entitlement', async () => {
    const owner = 'user_rc_other_entitlement';
    const { household: created } = await household(owner);
    await deliver(
      payload('rc-other-entitlement', 'INITIAL_PURCHASE', owner, {
        entitlement_id: 'unrelated',
        entitlement_ids: ['unrelated'],
      }),
    );

    expect((await entitlement(created.id))?.entitlement).toBe('free');
    expect(
      await db
        .select()
        .from(revenuecatEvents)
        .where(eq(revenuecatEvents.eventId, 'rc-other-entitlement')),
    ).toHaveLength(1);
    expect(analytics.sent.filter(({ event }) => event.event === 'purchase_completed')).toHaveLength(
      0,
    );
  });
});
