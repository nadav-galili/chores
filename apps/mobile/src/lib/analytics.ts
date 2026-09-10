import {
  ANALYTICS_HOST,
  kidProperties,
  parentIdentity,
  type AnalyticsEvent,
  type DeviceSession,
} from '@chores/shared';
import PostHog from 'posthog-react-native';
import type { DeviceDb } from '@/db/types';
import { cacheFetchedFlags } from '@/sync/flags';

/**
 * The one place this app talks to PostHog (ADR-0009, docs/spec/01-product.md).
 *
 * Two modes, deliberately unalike. A parent is a person the service may know: identified by their
 * Clerk id, grouped by household, and the only mode that asks for feature flags. A kid device is
 * an anon id from its join and three properties — ui mode, age band, household hash — and asks the
 * service for nothing at all, because a child is not an identity (ADR-0001) and the device has to
 * work with no network.
 *
 * Autocapture only happens under `PostHogProvider`, which this app does not mount; session replay,
 * surveys and geolocation are turned off explicitly. Nothing here is load-bearing: with no key —
 * a dev build, a test — every call is a no-op and the app behaves exactly the same.
 */

const apiKey = process.env.EXPO_PUBLIC_POSTHOG_KEY;

type Mode = 'parent' | 'kid';

let client: PostHog | null = null;
let mode: Mode | null = null;
/** Which device session the running kid client belongs to; null in parent mode. */
let kidIdentity: string | null = null;

function build(options: { distinctId?: string; flags: boolean }): PostHog | null {
  if (!apiKey) return null;
  return new PostHog(apiKey, {
    host: ANALYTICS_HOST,
    // The retention question is "did this child open the app today", which this app answers
    // itself, once per Chore Date. Lifecycle events would answer a different, noisier one.
    captureAppLifecycleEvents: false,
    enableSessionReplay: false,
    disableSurveys: true,
    // A push token is how the child is reached, not something analytics needs.
    capturePushNotificationSubscriptions: false,
    // No location, in either mode: nothing about where a family lives is worth knowing here.
    disableGeoip: true,
    // Kid mode never asks the service about flags (ADR-0009): `preloadFeatureFlags` stops the
    // fetch on init and `disableRemoteFeatureFlags` stops every later one, including the reload
    // an identity change would otherwise trigger. (The SDK's own remote-config read cannot be
    // turned off; it carries nothing about the device.)
    preloadFeatureFlags: options.flags,
    disableRemoteFeatureFlags: !options.flags,
    ...(options.distinctId ? { bootstrap: { distinctId: options.distinctId } } : {}),
  });
}

/**
 * Kid mode's client: the anon id minted at redemption is the distinct id from the first event,
 * and the three allowed properties ride every event after that.
 */
export async function startKidAnalytics(session: DeviceSession): Promise<void> {
  // The anon id is rotated when a device is revoked and rejoins (ADR-0009), and the ui mode a
  // parent chose can move under it, so what is already running is compared against the session,
  // never merely against the mode: a rejoined device must not go on reporting as the old one.
  const identity = [session.analytics_anon_id, session.child.ui_mode, session.household.id].join(
    '/',
  );
  if (client && kidIdentity === identity) return;
  await shutdownAnalytics();
  mode = 'kid';
  kidIdentity = identity;
  client = build({ distinctId: session.analytics_anon_id, flags: false });
  // The SDK persists a distinct id across launches, and `bootstrap` only fills an empty one. A
  // device that has held another id — a rotated anon id, a parent who signed in here — has to be
  // emptied before this session's id will stick.
  if (client && client.getDistinctId() !== session.analytics_anon_id) {
    client.reset();
    await client.shutdown();
    client = build({ distinctId: session.analytics_anon_id, flags: false });
  }
  await client?.register(
    kidProperties({ ui_mode: session.child.ui_mode, household_id: session.household.id }),
  );
}

/** Parent mode's client: the Clerk user, in their household's group. */
export async function startParentAnalytics(
  clerkUserId: string,
  householdId: string | null,
): Promise<void> {
  if (mode !== 'parent' || !client) {
    await shutdownAnalytics();
    mode = 'parent';
    client = build({ flags: true });
    // Identifying on top of an id this device already held would alias the two people — and on a
    // phone that was in kid mode, the other person is a child (ADR-0009). Start from nothing.
    client?.reset();
  }
  const identity = parentIdentity(clerkUserId, householdId);
  client?.identify(identity.distinct_id);
  for (const [type, key] of Object.entries(identity.groups)) client?.group(type, key);
}

export function capture(event: AnalyticsEvent): void {
  client?.capture(event.event, event.properties);
}

/**
 * Parent mode fetches the flags and writes them through to SQLite, which is the only way a kid
 * device ever learns one: it must work offline, and it has no identity the service would evaluate
 * a flag against. A fetch that fails leaves the cache alone — the last known answer beats none.
 *
 * The pet and the grove are separate flags because they are separate bets: week-three retention
 * has to be attributable to one or the other, so either can be turned off without the other.
 */
export async function refreshFlags(db: DeviceDb, now = new Date()): Promise<void> {
  if (!client || mode !== 'parent') return;
  const fetched = await client.reloadFeatureFlagsAsync();
  if (fetched) await cacheFetchedFlags(db, fetched, now);
}

/**
 * Flushes and forgets the client. The reset is the point: the SDK persists its distinct id and
 * super properties per project key, and this app is one binary with two modes, so without it a
 * parent signing in on a device that was in kid mode would `identify` on top of the child's anon
 * id — aliasing the two — and go on sending the child's ui mode and household hash. A child is
 * anonymous per device, and stays that way (ADR-0009).
 */
export async function shutdownAnalytics(): Promise<void> {
  const going = client;
  client = null;
  mode = null;
  kidIdentity = null;
  going?.reset();
  await going?.shutdown();
}

/**
 * Whether an event captured now would actually go anywhere: there is a key, and a client is up.
 * The callers that dedupe a once-a-day event ask first, so a report that would be dropped is not
 * recorded as already sent.
 */
export function analyticsReady(): boolean {
  return client !== null;
}
