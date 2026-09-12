import { createHmac } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { addDays, choreDate, historyWindow, uuid7, type ParentWeek } from '@chores/shared';
import { beforeAll, describe, expect, it } from 'vitest';
import { createApp } from './app.ts';
import type { Db } from './db/client.ts';
import { children } from './db/schema.ts';
import { writeHouseholdInstances } from './materialize.ts';
import { asParent, fakeVerifyToken } from './test/auth.ts';
import { freshDb } from './test/db.ts';
import { completeOp, setupHousehold, syncAs, TEST_TZ, testToday } from './test/household.ts';

/**
 * M3.14 closing sweep: free × premium × every gated action on one household fixture.
 *
 * `add_child` never refuses — over quota it stamps grace — so it asserts the stamp, not a
 * 402. `full_history` is the deliberate exception: free gets a clamped 200, never a 402.
 * Every other refusal goes through `expectGated`, so a route answering anything but
 * `402 {error: 'gated', gate}` fails here. Mid-test a signed RevenueCat webhook flips the
 * household to premium (refused calls now pass), then an expiry re-locks it.
 */
const SECRET = 'rcwhsec_gate_matrix_test';
const PRODUCT = 'mibo_yearly';

let db: Db;
let app: ReturnType<typeof createApp>;

beforeAll(async () => {
  db = await freshDb();
  app = createApp(db, {
    verifyToken: fakeVerifyToken,
    redeemLimit: { max: 1000, windowMs: 60_000 },
    revenuecatWebhookSigningSecret: SECRET,
  });
});

/** The one shape every gated refusal must answer. */
async function expectGated(res: Response, gate: string) {
  expect(res.status).toBe(402);
  expect(await res.json()).toEqual({ error: 'gated', gate });
}

function rcEvent(id: string, type: string, appUserId: string, eventTimestampMs: number) {
  return {
    api_version: '1.0',
    event: {
      id,
      type,
      event_timestamp_ms: eventTimestampMs,
      app_user_id: appUserId,
      original_app_user_id: appUserId,
      aliases: [],
      product_id: PRODUCT,
      purchased_at_ms: eventTimestampMs,
      expiration_at_ms: eventTimestampMs + 30 * 24 * 60 * 60 * 1000,
      entitlement_ids: ['premium'],
      environment: 'SANDBOX',
    },
  };
}

async function deliverWebhook(event: ReturnType<typeof rcEvent>) {
  const body = JSON.stringify(event);
  const timestamp = Math.floor(Date.now() / 1000);
  const digest = createHmac('sha256', SECRET).update(`${timestamp}.${body}`).digest('hex');
  return app.request('/webhooks/revenuecat', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-revenuecat-webhook-signature': `t=${timestamp},v1=${digest}`,
    },
    body,
  });
}

describe('the gate matrix, end to end', () => {
  it('refuses on free, unlocks on purchase, re-locks on expiry; the child is never refused', async () => {
    const owner = 'user_gate_matrix';
    const fx = await setupHousehold(app, owner);
    const { householdId, noa, ori } = fx;
    const base = `/households/${householdId}`;
    const today = choreDate(new Date(), TEST_TZ, 0);
    const tenAgo = addDays(today, -10);

    // Minimal rows: one chore to read history through, one for the child smoke to complete.
    const historyChore = await fx.addChore('History dishes', [noa.id]);
    const smokeChore = await fx.addChore('Smoke', [noa.id]);
    await writeHouseholdInstances(db, householdId, tenAgo);
    await writeHouseholdInstances(db, householdId, today);
    // Grace is over: the over-quota second child is now parent-read-only.
    await db
      .update(children)
      .set({ readOnlyAfter: new Date('2020-01-01T00:00:00.000Z') })
      .where(eq(children.id, ori.id));

    const editOri = () =>
      app.request(
        `${base}/children/${ori.id}`,
        asParent(owner, {
          method: 'PATCH',
          body: JSON.stringify({
            first_name: 'Or',
            ui_mode: 'little',
            pet_name: 'Zed',
            reminder_time: '08:00',
          }),
        }),
      );
    const invite = (email: string) =>
      app.request(`${base}/parents`, asParent(owner, { method: 'POST', body: JSON.stringify({ email }) }));
    const customReward = (id: string) =>
      app.request(
        `${base}/rewards/${id}`,
        asParent(owner, {
          method: 'PUT',
          body: JSON.stringify({
            title: 'Family movie',
            icon: '🎬',
            cost_coins: 225,
            active: true,
            sort: 20,
            updated_at: new Date().toISOString(),
          }),
        }),
      );
    const ledger = () => app.request(`${base}/money-ledger`, asParent(owner));
    const photoChore = (id: string) =>
      app.request(
        `${base}/chores/${id}`,
        asParent(owner, {
          method: 'PUT',
          body: JSON.stringify({
            fields: { title: 'Photo chore', kind: 'daily', assignees: [noa.id], requires_photo: true },
            updated_at: new Date().toISOString(),
          }),
        }),
      );
    const addChild = (first_name: string) =>
      app.request(
        `${base}/children`,
        asParent(owner, {
          method: 'POST',
          body: JSON.stringify({ first_name, ui_mode: 'big', pet_name: 'Pip' }),
        }),
      );
    const history = async (from: string) =>
      app.request(`${base}/children/${noa.id}/week?from=${from}`, asParent(owner));
    const childCompletes = async () => {
      const { status, body } = await syncAs(app, noa.session, [completeOp(smokeChore)]);
      expect(status).toBe(200);
      expect(body.rejected).toEqual([]);
    };
    const entitlement = async () =>
      ((await (await app.request('/me', asParent(owner))).json()) as {
        household: { entitlement: string };
      }).household.entitlement;

    // Free: every premium action refuses with the same shape; history clamps instead.
    expect(await entitlement()).toBe('free');
    const ava = await addChild('Ava');
    expect(ava.status).toBe(201);
    expect(((await ava.json()) as { read_only_after: string | null }).read_only_after).not.toBeNull();
    await expectGated(await editOri(), 'child_quota');
    expect((await invite('matrix-one@example.com')).status).toBe(201);
    await expectGated(await invite('matrix-two@example.com'), 'parent_quota');
    const rewardId = uuid7();
    await expectGated(await customReward(rewardId), 'custom_rewards');
    await expectGated(await ledger(), 'money_ledger');
    const photoId = uuid7();
    await expectGated(await photoChore(photoId), 'photo_proof');
    const freeHistory = await history(tenAgo);
    expect(freeHistory.status).toBe(200);
    const freeWeek = (await freeHistory.json()) as ParentWeek & { clamped?: boolean };
    expect(freeWeek.clamped).toBe(true);
    expect(freeWeek.chore_dates).toEqual(historyWindow(today));
    expect(freeWeek.chore_dates).toHaveLength(7);
    await childCompletes();

    // Purchase: the webhook flips the household and the same refused calls now pass.
    const purchasedAt = Date.now();
    expect((await deliverWebhook(rcEvent('matrix-initial', 'INITIAL_PURCHASE', owner, purchasedAt))).status).toBe(
      200,
    );
    expect(await entitlement()).toBe('premium');
    const ben = await addChild('Ben');
    expect(ben.status).toBe(201);
    expect(((await ben.json()) as { read_only_after: string | null }).read_only_after).toBeNull();
    expect((await editOri()).status).toBe(200);
    expect((await invite('matrix-three@example.com')).status).toBe(201);
    const createdReward = await customReward(rewardId);
    expect(createdReward.status).toBe(201);
    expect(await createdReward.json()).toMatchObject({ id: rewardId, title: 'Family movie' });
    expect((await ledger()).status).toBe(200);
    const createdPhoto = await photoChore(photoId);
    expect(createdPhoto.status).toBe(201);
    expect(await createdPhoto.json()).toMatchObject({ id: photoId, requires_photo: true });
    const premiumHistory = await history(tenAgo);
    expect(premiumHistory.status).toBe(200);
    const premiumWeek = (await premiumHistory.json()) as ParentWeek & { clamped?: boolean };
    expect(premiumWeek.clamped).toBe(false);
    expect(premiumWeek.chore_dates[0]).toBe(tenAgo);
    expect(premiumWeek.chore_dates.at(-1)).toBe(today);
    expect(premiumWeek.chore_dates).toHaveLength(11);
    expect(
      premiumWeek.chores.find((c) => c.chore_id === historyChore)?.cells,
    ).toHaveLength(2);
    await childCompletes();

    // Expiry: the same calls refuse again with the same shape; history still clamps, child still acts.
    expect(
      (await deliverWebhook(rcEvent('matrix-expire', 'EXPIRATION', owner, purchasedAt + 60_000))).status,
    ).toBe(200);
    expect(await entitlement()).toBe('free');
    await expectGated(await editOri(), 'child_quota');
    await expectGated(await invite('matrix-four@example.com'), 'parent_quota');
    await expectGated(await customReward(uuid7()), 'custom_rewards');
    await expectGated(await ledger(), 'money_ledger');
    await expectGated(await photoChore(uuid7()), 'photo_proof');
    // A chore that already requires a photo keeps it: setting true→true is no new gate.
    expect((await photoChore(photoId)).status).toBe(200);
    const relockedHistory = await history(tenAgo);
    expect(relockedHistory.status).toBe(200);
    expect(((await relockedHistory.json()) as ParentWeek & { clamped?: boolean }).clamped).toBe(true);
    await childCompletes();

    expect(testToday()).toBe(today);
  });
});
