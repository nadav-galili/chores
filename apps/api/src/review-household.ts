import {
  addDays,
  BUILTIN_REWARDS,
  builtinRewardId,
  choreDate,
  uuid7,
  type DeviceSession,
  type IsoDate,
  type SyncResponse,
} from '@chores/shared';
import { eq } from 'drizzle-orm';
import { createApp } from './app.ts';
import type { Db } from './db/client.ts';
import { childDevices, households, parents } from './db/schema.ts';
import { writeHouseholdInstances } from './materialize.ts';
import { photoKey } from './photo-key.ts';

/**
 * "The Review Family" (#100): the household App Review and TestFlight testers sign into. Built
 * through the API's own routes, in-process, exactly as a parent and two Kid Devices would build
 * it — so every ledger, XP, day-summary and growth row is the one the product itself writes, and
 * nothing here restates a rule.
 *
 * Rerunnable from nothing. A reviewer leaves the household in whatever state they like, so a
 * rerun does not edit it back (ledger, XP, completion and growth rows are append-only): it retires
 * the old one instead — its Kid Devices are revoked and the review account's Parent row is
 * renamed off the Clerk user — and builds a new household beside it. The old rows stay, owned by
 * nobody who can sign in.
 */

export const REVIEW_HOUSEHOLD_NAME = 'The Review Family';
export const REVIEW_PIN = '1234';
/** Cupertino: a reviewer's "today" is the household's today. */
const REVIEW_TZ = 'America/Los_Angeles';
/** How far back the week of history reaches. */
const HISTORY_DAYS = 6;

/**
 * How premium is set: a manual write, the single exception ADR-0016's amendment names — this seed
 * only, run by an operator, never reachable from a route. This household has no purchase behind
 * it, and forging a signed RevenueCat event would put a fake row in `revenuecat_events` that reads as a
 * real one. The source names itself so the row cannot be mistaken for a purchase, and a real
 * sandbox purchase by a reviewer still flows through the webhook as usual (its later EXPIRATION
 * may return the household to free — the next rerun restores it).
 */
export const REVIEW_ENTITLEMENT_SOURCE = 'manual:review-household';

export type SeedOptions = {
  clerkUserId: string;
  email: string;
  now?: Date;
  /** Stores the photo proof at its canonical key (ADR-0017). */
  uploadPhoto: (key: string) => Promise<void>;
};

export type SeededHousehold = {
  householdId: string;
  children: { id: string; firstName: string }[];
  /** Yesterday's photo chore, tapped without a photo: waiting on a parent, nothing to open. */
  awaitingApprovalCompletionId: string;
  /** Today's photo chore, done with its photo proof and waiting on a parent. */
  photoProofCompletionId: string;
  pendingRedemptionId: string;
};

type Chore = { title: string; icon: string; requiresPhoto?: boolean };

const LITTLE = { first_name: 'Maya', ui_mode: 'little', pet_name: 'Pip' } as const;
const BIG = { first_name: 'Leo', ui_mode: 'big', pet_name: 'Rex' } as const;
const LITTLE_CHORES: Chore[] = [
  { title: 'Make the bed', icon: '🛏️' },
  { title: 'Feed the fish', icon: '🐟' },
  { title: 'Put toys away', icon: '🧸' },
];
const BIG_CHORES: Chore[] = [
  { title: 'Brush teeth', icon: '🪥' },
  { title: 'Homework', icon: '📚' },
  { title: 'Water the plants', icon: '🪴', requiresPhoto: true },
];
const CUSTOM_REWARDS = [
  { title: 'Pick the movie', icon: '🎬', cost_coins: 80 },
  { title: 'Stay up 30 minutes later', icon: '🌙', cost_coins: 120 },
];

/** Takes the old review household out of reach, if there is one. Nothing is deleted. */
async function retirePrevious(db: Db, clerkUserId: string, now: Date) {
  const [previous] = await db.select().from(parents).where(eq(parents.clerkUserId, clerkUserId));
  if (!previous) return;
  await db
    .update(childDevices)
    .set({ revokedAt: now })
    .where(eq(childDevices.householdId, previous.householdId));
  await db
    .update(parents)
    .set({ clerkUserId: `${clerkUserId}:retired:${now.getTime()}`, email: null })
    .where(eq(parents.id, previous.id));
}

export async function seedReviewHousehold(db: Db, options: SeedOptions): Promise<SeededHousehold> {
  const { clerkUserId, email, uploadPhoto } = options;
  const now = options.now ?? new Date();
  await retirePrevious(db, clerkUserId, now);

  const PARENT_TOKEN = 'review-seed';
  const app = createApp(db, {
    verifyToken: async (token) => (token === PARENT_TOKEN ? { clerkUserId, email } : null),
  });
  const call = async <T>(path: string, method: string, body?: unknown, token = PARENT_TOKEN) => {
    const res = await app.request(path, {
      method,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!res.ok) throw new Error(`seed: ${method} ${path} answered ${res.status}`);
    return (await res.json()) as T;
  };

  const { household } = await call<{ household: { id: string } }>('/households', 'POST', {
    name: REVIEW_HOUSEHOLD_NAME,
    tz: REVIEW_TZ,
    currency: 'USD',
  });
  const h = `/households/${household.id}`;
  // Before the second child and the photo chore, both of which are premium.
  await db
    .update(households)
    .set({ entitlement: 'premium', entitlementSource: REVIEW_ENTITLEMENT_SOURCE })
    .where(eq(households.id, household.id));
  await call(`${h}/pin`, 'PUT', { pin: REVIEW_PIN });

  const today = choreDate(now, REVIEW_TZ, 0);
  const firstDay = addDays(today, -HISTORY_DAYS);
  const stamp = now.toISOString();

  const addChild = async (input: typeof LITTLE | typeof BIG, list: Chore[]) => {
    const child = await call<{ id: string }>(`${h}/children`, 'POST', input);
    const chores: (Chore & { id: string })[] = [];
    for (const chore of list) {
      const id = uuid7();
      await call(`${h}/chores/${id}`, 'PUT', {
        fields: {
          title: chore.title,
          icon: chore.icon,
          kind: 'daily',
          start_date: firstDay,
          requires_photo: chore.requiresPhoto ?? false,
          assignees: [child.id],
        },
        updated_at: stamp,
      });
      chores.push({ ...chore, id });
    }
    const { code } = await call<{ code: string }>(`${h}/children/${child.id}/join-code`, 'POST');
    const session = await call<DeviceSession>('/join-codes/redeem', 'POST', {
      code,
      platform: 'ios',
    });
    return { id: child.id, firstName: input.first_name, chores, session };
  };
  const maya = await addChild(LITTLE, LITTLE_CHORES);
  const leo = await addChild(BIG, BIG_CHORES);

  // The past week as the boundary cron would have left it: every day's instances exist, so a
  // completion names its own Chore Date however far back it is (ADR-0003).
  for (let d = firstDay; d < today; d = addDays(d, 1)) {
    await writeHouseholdInstances(db, household.id, d);
  }

  const complete = (choreId: string, date: IsoDate, completionId = uuid7(), key?: string) => ({
    op_id: uuid7(),
    type: 'complete',
    payload: {
      completion_id: completionId,
      chore_id: choreId,
      chore_date: date,
      completed_at: stamp,
      ...(key ? { photo_key: key } : {}),
    },
  });
  const sync = async (child: typeof maya, ops: unknown[]) => {
    const body = await call<SyncResponse>(
      '/sync',
      'POST',
      { device_id: child.session.device_id, cursor: 0, ops },
      child.session.device_token,
    );
    if (body.rejected.length) throw new Error(`seed: sync refused ${body.rejected[0]!.reason}`);
  };

  // Maya: five complete days, a missed chore yesterday (the streak ends), one done today.
  const mayaOps = [];
  for (let d = firstDay; d < addDays(today, -1); d = addDays(d, 1)) {
    for (const chore of maya.chores) mayaOps.push(complete(chore.id, d));
  }
  mayaOps.push(complete(maya.chores[0]!.id, addDays(today, -1)));
  mayaOps.push(complete(maya.chores[1]!.id, addDays(today, -1)));
  mayaOps.push(complete(maya.chores[0]!.id, today));
  await sync(maya, mayaOps);

  // Leo: two days complete, his photo chore approved on each. Two items waiting on a parent, kept
  // apart (#100): yesterday's photo chore tapped with no photo (awaiting approval), and today's
  // done with its photo proof.
  const [teeth, homework, plants] = leo.chores as [Chore & { id: string }, ...typeof leo.chores];
  const leoOps = [];
  const toApprove: string[] = [];
  for (let d = addDays(today, -3); d < addDays(today, -1); d = addDays(d, 1)) {
    const photoCompletion = uuid7();
    toApprove.push(photoCompletion);
    leoOps.push(
      complete(teeth.id, d),
      complete(homework!.id, d),
      complete(plants!.id, d, photoCompletion),
    );
  }
  const awaitingApprovalCompletionId = uuid7();
  leoOps.push(
    complete(teeth.id, addDays(today, -1)),
    complete(homework!.id, addDays(today, -1)),
    complete(plants!.id, addDays(today, -1), awaitingApprovalCompletionId),
  );
  const photoProofCompletionId = uuid7();
  const proofKey = photoKey(leo.id, photoProofCompletionId);
  await uploadPhoto(proofKey);
  leoOps.push(complete(teeth.id, today));
  leoOps.push(complete(plants!.id, today, photoProofCompletionId, proofKey));
  await sync(leo, leoOps);
  for (const completionId of toApprove) {
    await call(`${h}/completions/${completionId}/approve`, 'POST');
  }

  let sort = BUILTIN_REWARDS.length;
  for (const reward of CUSTOM_REWARDS) {
    await call(`${h}/rewards/${uuid7()}`, 'PUT', {
      ...reward,
      active: true,
      sort: sort++,
      updated_at: stamp,
    });
  }

  // One request waiting on a parent. The coins left Maya's balance when she asked (ADR-0014).
  const pendingRedemptionId = uuid7();
  await sync(maya, [
    {
      op_id: uuid7(),
      type: 'request_redemption',
      payload: {
        redemption_id: pendingRedemptionId,
        reward_id: builtinRewardId(household.id, 'snack'),
        requested_at: stamp,
      },
    },
  ]);

  // The seed's own devices were only ever a way to write the child's side; the reviewer joins
  // their own. Revoked, they stop answering and show as ended in the parent's device list.
  for (const child of [maya, leo]) {
    await call(`${h}/children/${child.id}/devices/${child.session.device_id}`, 'DELETE');
  }

  return {
    householdId: household.id,
    children: [maya, leo].map(({ id, firstName }) => ({ id, firstName })),
    awaitingApprovalCompletionId,
    photoProofCompletionId,
    pendingRedemptionId,
  };
}
