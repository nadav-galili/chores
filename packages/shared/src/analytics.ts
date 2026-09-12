import type { UiMode } from './child.ts';
import type { DevicePlatform } from './join-code.ts';
import type { ChoreKind } from './materialize.ts';
import type { BuiltinRewardKey } from './reward.ts';
import { uuid5 } from './uuid5.ts';

/**
 * What this app is allowed to know about how it is used (docs/spec/01-product.md, ADR-0009).
 *
 * Every event the product sends is built here, on both sides of the wire, for one reason: a child
 * is not a person the analytics store may know. A parent is identified by their Clerk id and
 * grouped by household; a kid device is a random anon id from its join, carrying nothing but the
 * ui mode it draws in, an age band and a hashed household. Never a child id, a first name or a
 * pet name — the test next to this file is what keeps that true.
 *
 * The builders return the event and its properties and send nothing themselves: the device hands
 * them to posthog-react-native, the API to posthog-node, and a test to a list.
 */

/** The EU ingest host. This project's data does not leave the EU. */
export const ANALYTICS_HOST = 'https://eu.i.posthog.com';

/** Only what a value can be on the wire; nothing here is ever free text about a person. */
export type AnalyticsProperties = Record<string, string | number | boolean>;

export type AnalyticsEvent = { event: string; properties: AnalyticsProperties };

/**
 * The child's age band, as coarsely as the product knows it. There is no birthdate anywhere in
 * the data model and there will not be one (COPPA-minimal: first name only), so the band is read
 * off the ui mode a parent chose — the one age judgement the product does ask for. `big` cannot
 * be split into 8-10 and 11+ without asking for an age, so it is reported as one band.
 */
export type AgeBand = '5-7' | '8+';

export function ageBand(uiMode: UiMode): AgeBand {
  return uiMode === 'little' ? '5-7' : '8+';
}

/**
 * A household as analytics may refer to it: a hash, not the id. Deterministic on device and
 * server, so events from both sides land on the same household without either sending the id.
 */
export function householdHash(householdId: string): string {
  return uuid5('household_hash', householdId);
}

/** What every kid-device event carries, and the whole of what a kid device may say about itself. */
export function kidProperties(device: {
  ui_mode: UiMode;
  household_id: string;
}): AnalyticsProperties {
  return {
    ui_mode: device.ui_mode,
    age_band: ageBand(device.ui_mode),
    household_hash: householdHash(device.household_id),
  };
}

/** Parent mode: the Clerk user is the person, the household is the group. */
export function parentIdentity(
  clerkUserId: string,
  householdId: string | null,
): { distinct_id: string; groups: Record<string, string> } {
  return {
    distinct_id: clerkUserId,
    groups: householdId ? { household: householdId } : {},
  };
}

/**
 * Activation: a parent has a household. Every builder here names the properties it sends one by
 * one rather than spreading its argument: a caller handing over a whole row must not be able to
 * ship a field nobody meant to send.
 */
export function householdCreated(household: { currency: string; tz: string }): AnalyticsEvent {
  return {
    event: 'household_created',
    properties: { currency: household.currency, tz: household.tz },
  };
}

/** Activation: a parent has written a chore, and for how many children. */
export function choreCreated(chore: { kind: ChoreKind; assignee_count: number }): AnalyticsEvent {
  return {
    event: 'chore_created',
    properties: { kind: chore.kind, assignee_count: chore.assignee_count },
  };
}

/**
 * Activation: a kid device exists. Sent by the API under the device's own new anon id, which is
 * the first thing that id is ever used for. It asks for the ui mode and the household rather than
 * the child, so there is no first name or pet name here to drop.
 */
export function joinCodeRedeemed(redeem: {
  ui_mode: UiMode;
  household_id: string;
  platform: DevicePlatform;
}): AnalyticsEvent {
  return {
    event: 'join_code_redeemed',
    properties: {
      ...kidProperties({ ui_mode: redeem.ui_mode, household_id: redeem.household_id }),
      platform: redeem.platform,
    },
  };
}

/** The retention question: did this device open today. Deduped per chore date by the device. */
export function kidAppOpen(): AnalyticsEvent {
  return { event: 'kid_app_open', properties: {} };
}

/** A tap that counted, and whether it counted with no network — the offline promise, measured. */
export function choreCompleted(tap: { offline: boolean }): AnalyticsEvent {
  return { event: 'chore_completed', properties: { offline: tap.offline } };
}

/**
 * How long the child waited for the pet after tapping. The done moment is created in the tap's own
 * tick, so this measures render, not network; a clock that went backwards reports 0 rather than a
 * negative reaction.
 */
export function petReacted(reaction: { tapped_at: number; shown_at: number }): AnalyticsEvent {
  return {
    event: 'pet_reacted',
    properties: { ms: Math.max(0, Math.round(reaction.shown_at - reaction.tapped_at)) },
  };
}

/** The child finished everything due today. */
export function kidDayComplete(day: { streak: number }): AnalyticsEvent {
  return { event: 'kid_day_complete', properties: { streak: day.streak } };
}

/** A tree was planted; the stage is the child's own `COUNT(*)` after it (ADR-0011). */
export function groveGrew(grove: { stage: number }): AnalyticsEvent {
  return { event: 'grove_grew', properties: { stage: grove.stage } };
}

/**
 * The child spent coins on something. Whether the reward loop is used at all is the question M2
 * asks of it, and a `builtin_key` is a catalog constant — it names a snack, never a child — so it
 * is the one thing about a Redemption allowed to cross (ADR-0009). A custom reward, when M3 has
 * them, has no key and sends no event rather than sending a parent's own words.
 */
export function rewardRequested(reward: {
  builtin_key: BuiltinRewardKey;
  cost_coins: number;
}): AnalyticsEvent {
  return {
    event: 'reward_requested',
    properties: { builtin_key: reward.builtin_key, cost_coins: reward.cost_coins },
  };
}

/**
 * A parent decided a Redemption: the one number the reward loop turns on. Sent server-side under
 * the parent's Clerk id — the decision, and nothing about the child who asked or what they asked
 * for (ADR-0009).
 */
export function redemptionDecided(decision: { decision: 'approved' | 'declined' }): AnalyticsEvent {
  return { event: 'redemption_decided', properties: { decision: decision.decision } };
}
