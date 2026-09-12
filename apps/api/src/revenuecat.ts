import { createHmac, timingSafeEqual } from 'node:crypto';
import { and, desc, eq, inArray, ne } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import { purchaseCompleted } from '@chores/shared';
import type { Analytics } from './analytics.ts';
import type { Db } from './db/client.ts';
import { households, parents, revenuecatEvents } from './db/schema.ts';

const SIGNATURE_TOLERANCE_SECONDS = 5 * 60;
const PREMIUM_EVENT_TYPES = new Set([
  'INITIAL_PURCHASE',
  'RENEWAL',
  'CANCELLATION',
  'EXPIRATION',
  'PRODUCT_CHANGE',
  'NON_RENEWING_PURCHASE',
]);

const envelopeSchema = z
  .object({
    api_version: z.string(),
    event: z
      .object({
        id: z.string().min(1),
        type: z.string().min(1),
        event_timestamp_ms: z.number().int(),
        app_user_id: z.string().nullish(),
        original_app_user_id: z.string().nullish(),
        aliases: z.array(z.string()).optional(),
        product_id: z.string().nullish(),
        new_product_id: z.string().nullish(),
        entitlement_id: z.string().nullish(),
        entitlement_ids: z.array(z.string()).nullish(),
        expiration_at_ms: z.number().int().nullish(),
      })
      .passthrough(),
  })
  .passthrough();

type Envelope = z.infer<typeof envelopeSchema>;

function verified(rawBody: string, header: string | undefined, secret: string): boolean {
  if (!header) return false;
  const values = Object.fromEntries(
    header.split(',').map((part) => {
      const [key, ...rest] = part.trim().split('=');
      return [key, rest.join('=')];
    }),
  );
  const timestamp = Number(values.t);
  const signature = values.v1;
  if (!Number.isSafeInteger(timestamp) || !signature || !/^[a-f\d]{64}$/i.test(signature)) {
    return false;
  }
  if (Math.abs(Math.floor(Date.now() / 1000) - timestamp) > SIGNATURE_TOLERANCE_SECONDS) {
    return false;
  }
  const expected = createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest();
  return timingSafeEqual(expected, Buffer.from(signature, 'hex'));
}

function identityCandidates(event: Envelope['event']): string[] {
  return [event.app_user_id, event.original_app_user_id, ...(event.aliases ?? [])].filter(
    (id, index, ids): id is string => Boolean(id) && ids.indexOf(id) === index,
  );
}

function affectsPremium(event: Envelope['event']): boolean {
  return event.entitlement_id === 'premium' || (event.entitlement_ids ?? []).includes('premium');
}

export function revenuecatRoutes(db: Db, analytics: Analytics, signingSecret: string | undefined) {
  const app = new Hono();

  app.post('/webhooks/revenuecat', async (c) => {
    const rawBody = await c.req.text();
    if (
      !signingSecret ||
      !verified(rawBody, c.req.header('x-revenuecat-webhook-signature'), signingSecret)
    ) {
      console.warn('RevenueCat webhook signature verification failed');
      return c.json({ error: 'invalid_signature' }, 401);
    }

    let decoded: unknown;
    try {
      decoded = JSON.parse(rawBody);
    } catch (cause) {
      console.warn('RevenueCat webhook body was not JSON', { cause });
      return c.json({ error: 'invalid_body' }, 400);
    }
    const parsed = envelopeSchema.safeParse(decoded);
    if (!parsed.success) return c.json({ error: 'invalid_body' }, 400);

    const event = parsed.data.event;
    const candidates = identityCandidates(event);
    if (PREMIUM_EVENT_TYPES.has(event.type) && (!event.product_id || candidates.length === 0)) {
      return c.json({ error: 'invalid_event' }, 400);
    }

    const matches = candidates.length
      ? await db.select().from(parents).where(inArray(parents.clerkUserId, candidates))
      : [];
    const householdIds = [...new Set(matches.map((parent) => parent.householdId))];
    if (householdIds.length === 0) return c.json({ error: 'parent_not_found' }, 422);
    if (householdIds.length > 1) return c.json({ error: 'ambiguous_parent' }, 409);
    const householdId = householdIds[0]!;
    const purchasingParent =
      matches.find((parent) => parent.clerkUserId === event.app_user_id) ?? matches[0]!;

    const applied = await db.transaction(async (tx) => {
      // Serialize every event for one household. Different RevenueCat deliveries may be handled
      // concurrently, but an older event must never win merely because its transaction ended last.
      const [current] = await tx
        .select({ entitlementSource: households.entitlementSource })
        .from(households)
        .where(eq(households.id, householdId))
        .for('update');
      const inserted = await tx
        .insert(revenuecatEvents)
        .values({
          eventId: event.id,
          householdId,
          type: event.type,
          eventTimestampMs: event.event_timestamp_ms,
          payload: parsed.data,
        })
        .onConflictDoNothing()
        .returning({ eventId: revenuecatEvents.eventId });
      if (inserted.length === 0) return false;
      if (!PREMIUM_EVENT_TYPES.has(event.type) || !affectsPremium(event)) return true;

      const [latestOther] = await tx
        .select({ eventTimestampMs: revenuecatEvents.eventTimestampMs })
        .from(revenuecatEvents)
        .where(
          and(
            eq(revenuecatEvents.householdId, householdId),
            ne(revenuecatEvents.eventId, event.id),
          ),
        )
        .orderBy(desc(revenuecatEvents.eventTimestampMs))
        .limit(1);

      const lifetime = event.type === 'NON_RENEWING_PURCHASE' && event.expiration_at_ms == null;
      const lifetimeCancellation = event.type === 'CANCELLATION' && event.expiration_at_ms == null;
      const hasLifetime = current?.entitlementSource?.startsWith('revenuecat:lifetime:') ?? false;
      if (!lifetime && latestOther && latestOther.eventTimestampMs > event.event_timestamp_ms) {
        return true;
      }
      if (hasLifetime && !lifetime && !lifetimeCancellation) return true;

      const productId = event.type === 'PRODUCT_CHANGE' ? event.new_product_id : event.product_id;
      await tx
        .update(households)
        .set({
          entitlement: event.type === 'EXPIRATION' || lifetimeCancellation ? 'free' : 'premium',
          entitlementSource: lifetime
            ? `revenuecat:lifetime:${event.product_id}`
            : `revenuecat:${productId ?? event.product_id}`,
        })
        .where(eq(households.id, householdId));
      return true;
    });

    const completed =
      event.type === 'INITIAL_PURCHASE' ||
      (event.type === 'NON_RENEWING_PURCHASE' && event.expiration_at_ms == null);
    if (applied && completed && affectsPremium(event)) {
      analytics.capture({
        distinctId: purchasingParent.clerkUserId,
        event: purchaseCompleted({
          product_id: event.product_id!,
          purchase_kind: event.type === 'INITIAL_PURCHASE' ? 'subscription' : 'lifetime',
        }),
        groups: { household: householdId },
      });
    }
    return c.json({ ok: true });
  });

  return app;
}
