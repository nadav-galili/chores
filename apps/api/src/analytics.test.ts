import { householdHash, uuid7 } from '@chores/shared';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { recordingAnalytics } from './analytics.ts';
import { createApp } from './app.ts';
import type { Db } from './db/client.ts';
import { asParent, fakeVerifyToken } from './test/auth.ts';
import { freshDb } from './test/db.ts';
import { setTestPin } from './test/household.ts';

let db: Db;
let app: ReturnType<typeof createApp>;
let analytics: ReturnType<typeof recordingAnalytics>;

const parent = 'user_ima_at_example.com';
const CHILD = { first_name: 'Noa', ui_mode: 'little', pet_name: 'Pip' };

beforeAll(async () => {
  db = await freshDb();
});

beforeEach(async () => {
  analytics = recordingAnalytics();
  app = createApp(db, { verifyToken: fakeVerifyToken, analytics });
});

const events = (name: string) => analytics.sent.filter((s) => s.event.event === name);

/** A household, a child, a chore and a redeemed join code: every activation event, in order. */
async function activate(clerkUserId: string) {
  const created = await app.request(
    '/households',
    asParent(clerkUserId, {
      method: 'POST',
      body: JSON.stringify({ name: 'Galili', tz: 'Asia/Jerusalem', currency: 'ILS' }),
    }),
  );
  const { household } = (await created.json()) as { household: { id: string } };
  await setTestPin(app, clerkUserId, household.id);

  const childRes = await app.request(
    `/households/${household.id}/children`,
    asParent(clerkUserId, { method: 'POST', body: JSON.stringify(CHILD) }),
  );
  const child = (await childRes.json()) as { id: string };

  const choreId = uuid7();
  await app.request(
    `/households/${household.id}/chores/${choreId}`,
    asParent(clerkUserId, {
      method: 'PUT',
      body: JSON.stringify({
        fields: { title: 'Brush teeth', kind: 'daily', assignees: [child.id] },
        updated_at: new Date().toISOString(),
      }),
    }),
  );

  const issued = (await (
    await app.request(
      `/households/${household.id}/children/${child.id}/join-code`,
      asParent(clerkUserId, { method: 'POST' }),
    )
  ).json()) as { code: string };
  const redeemed = await app.request('/join-codes/redeem', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code: issued.code, platform: 'android' }),
  });
  const session = (await redeemed.json()) as { analytics_anon_id: string };

  return { householdId: household.id, childId: child.id, choreId, session };
}

describe('activation events', () => {
  it('reports a household under the parent, grouped by the household', async () => {
    const { householdId } = await activate(parent);
    expect(events('household_created')).toEqual([
      {
        distinctId: parent,
        event: {
          event: 'household_created',
          properties: { currency: 'ILS', tz: 'Asia/Jerusalem' },
        },
        groups: { household: householdId },
      },
    ]);
  });

  it('reports a chore only when one is created, not on every write to it', async () => {
    const { householdId, choreId } = await activate('user_abba_at_example.com');
    expect(events('chore_created')).toHaveLength(1);
    expect(events('chore_created')[0]!.event.properties).toEqual({
      kind: 'daily',
      assignee_count: 1,
    });

    await app.request(
      `/households/${householdId}/chores/${choreId}`,
      asParent('user_abba_at_example.com', {
        method: 'PUT',
        body: JSON.stringify({
          fields: { title: 'Brush teeth twice' },
          updated_at: new Date().toISOString(),
        }),
      }),
    );
    expect(events('chore_created')).toHaveLength(1);
  });

  it('reports a redeemed code under the new device, not under the parent', async () => {
    const { householdId, session } = await activate('user_saba_at_example.com');
    expect(events('join_code_redeemed')).toEqual([
      {
        distinctId: session.analytics_anon_id,
        event: {
          event: 'join_code_redeemed',
          properties: {
            ui_mode: 'little',
            age_band: '5-7',
            household_hash: householdHash(householdId),
            platform: 'android',
          },
        },
      },
    ]);
  });

  it('says nothing when a code is refused', async () => {
    await app.request('/join-codes/redeem', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: 'ZZZZZZ', platform: 'android' }),
    });
    expect(events('join_code_redeemed')).toHaveLength(0);
  });
});

describe('what the server sends', () => {
  it('never carries a child id, first name or pet name (ADR-0009)', async () => {
    const { childId } = await activate('user_dod_at_example.com');
    const wire = JSON.stringify(analytics.sent);
    for (const secret of [childId, CHILD.first_name, CHILD.pet_name]) {
      expect(wire).not.toContain(secret);
    }
  });

  it('carries the household only as a group on a parent event, never as a property', async () => {
    const { householdId } = await activate('user_dod2_at_example.com');
    for (const { event } of analytics.sent) {
      expect(JSON.stringify(event.properties)).not.toContain(householdId);
    }
  });
});
