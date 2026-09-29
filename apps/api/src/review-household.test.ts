import { and, count, eq, isNull, sql } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { createApp } from './app.ts';
import type { Db } from './db/client.ts';
import {
  childDevices,
  children,
  completions,
  growthEntries,
  households,
  ledgerEntries,
  parents,
  redemptions,
  rewards,
} from './db/schema.ts';
import {
  REVIEW_ENTITLEMENT_SOURCE,
  REVIEW_HOUSEHOLD_NAME,
  seedReviewHousehold,
  type SeededHousehold,
} from './review-household.ts';
import { asParent } from './test/auth.ts';
import { freshDb } from './test/db.ts';

const REVIEWER = 'user_review';
const EMAIL = 'review@mibokids.app';

let db: Db;
let first: SeededHousehold;
let second: SeededHousehold;
const uploaded: string[] = [];

beforeAll(async () => {
  db = await freshDb();
  const uploadPhoto = async (key: string) => void uploaded.push(key);
  first = await seedReviewHousehold(db, { clerkUserId: REVIEWER, email: EMAIL, uploadPhoto });
  second = await seedReviewHousehold(db, { clerkUserId: REVIEWER, email: EMAIL, uploadPhoto });
});

const balance = async (childId: string) => {
  const [row] = await db
    .select({ coins: sql<number>`coalesce(sum(${ledgerEntries.coins}), 0)::int` })
    .from(ledgerEntries)
    .where(eq(ledgerEntries.childId, childId));
  return row!.coins;
};

describe('the review household seed', () => {
  it('signs the review account into The Review Family, premium, with a Parent PIN', async () => {
    const app = createApp(db, {
      verifyToken: async (t) => (t === REVIEWER ? { clerkUserId: REVIEWER, email: EMAIL } : null),
    });
    const me = (await (await app.request('/me', asParent(REVIEWER))).json()) as {
      household: { id: string; name: string; entitlement: string };
      children: { first_name: string; ui_mode: string }[];
      setup: { hasPin: boolean };
    };
    expect(me.household.id).toBe(second.householdId);
    expect(me.household.name).toBe(REVIEW_HOUSEHOLD_NAME);
    expect(me.household.entitlement).toBe('premium');
    expect(me.setup.hasPin).toBe(true);
    expect(me.children.map((c) => c.ui_mode).sort()).toEqual(['big', 'little']);
    const [row] = await db.select().from(households).where(eq(households.id, second.householdId));
    expect(row!.entitlementSource).toBe(REVIEW_ENTITLEMENT_SOURCE);
  });

  it('holds a week of work: approved photo chores, one with proof awaiting approval', async () => {
    const photos = await db
      .select({ status: completions.status, photoKey: completions.photoKey, id: completions.id })
      .from(completions)
      .where(
        and(
          eq(completions.householdId, second.householdId),
          sql`${completions.status} in ('pending_photo')`,
        ),
      );
    expect(photos).toHaveLength(1);
    expect(photos[0]!.id).toBe(second.pendingCompletionId);
    expect(photos[0]!.photoKey).toBe(uploaded.at(-1));
    const [accepted] = await db
      .select({ n: count() })
      .from(completions)
      .where(
        and(eq(completions.householdId, second.householdId), eq(completions.status, 'accepted')),
      );
    expect(accepted!.n).toBeGreaterThan(15);
  });

  it('has a grove, a catalogue, a pending redemption and coins to spend', async () => {
    const [trees] = await db
      .select({ n: count() })
      .from(growthEntries)
      .where(eq(growthEntries.householdId, second.householdId));
    expect(trees!.n).toBeGreaterThanOrEqual(3);
    const catalogue = await db
      .select()
      .from(rewards)
      .where(and(eq(rewards.householdId, second.householdId), isNull(rewards.deletedAt)));
    expect(catalogue.length).toBe(5);
    const [pending] = await db
      .select()
      .from(redemptions)
      .where(eq(redemptions.id, second.pendingRedemptionId));
    expect(pending!.status).toBe('requested');
    for (const child of second.children) expect(await balance(child.id)).toBeGreaterThan(0);
  });

  it('leaves no seed device able to sync', async () => {
    const live = await db
      .select()
      .from(childDevices)
      .where(and(eq(childDevices.householdId, second.householdId), isNull(childDevices.revokedAt)));
    expect(live).toHaveLength(0);
  });

  it('reruns from nothing: the old household is retired, not edited', async () => {
    expect(second.householdId).not.toBe(first.householdId);
    const [retired] = await db
      .select()
      .from(parents)
      .where(eq(parents.householdId, first.householdId));
    expect(retired!.clerkUserId).not.toBe(REVIEWER);
    expect(retired!.email).toBeNull();
    // The first household's rows are untouched: its children and coins are still there.
    const kids = await db
      .select()
      .from(children)
      .where(eq(children.householdId, first.householdId));
    expect(kids).toHaveLength(2);
    expect(await balance(kids[0]!.id)).toBeGreaterThan(0);
  });
});
