// How far through setup a household is. Derived from facts the server already holds, never stored
// (spec #86, "Setup is derived, never stored").

/** What `/me` reads off the household to decide the next setup step. */
export type SetupFacts = {
  hasHousehold: boolean;
  childCount: number;
  /** Non-deleted chores in the household. */
  choreCount: number;
  hasPin: boolean;
  /** Any `child_devices` row, revoked or not. */
  deviceEverJoined: boolean;
};

/** The `setup` object on `/me`: the facts, plus whether this parent created the household. */
export type MeSetup = SetupFacts & {
  /** False for an invited Partner, and for a parent with no household yet. */
  createdHousehold: boolean;
};

export type SetupStep = 'household' | 'child' | 'chore' | 'pin' | 'join_code' | 'done';

/**
 * The first unmet fact, in setup order. A Kid Device having ever joined is terminal: a deleted
 * chore, a revoked device or a reinstall never sends a family back into setup.
 */
export function nextSetupStep(facts: SetupFacts): SetupStep {
  if (facts.deviceEverJoined) return 'done';
  if (!facts.hasHousehold) return 'household';
  if (facts.childCount === 0) return 'child';
  if (facts.choreCount === 0) return 'chore';
  if (!facts.hasPin) return 'pin';
  return 'join_code';
}

/**
 * The step a parent is routed into on the first navigation after sign-in, or null for none. Only
 * the parent who created the household is walked through setup: a Partner only ever sees the
 * Finish setup card, and a parent with no household is the household form's, not this.
 */
export function setupStepOnSignIn(setup: MeSetup): Exclude<SetupStep, 'household' | 'done'> | null {
  if (!setup.createdHousehold) return null;
  const step = nextSetupStep(setup);
  return step === 'household' || step === 'done' ? null : step;
}

/**
 * The child whose "connected" confirmation a parent's phone should show on this open, or null.
 *
 * `awaitingChildId` is the phone's own "last seen" record: the child whose Join Code step it showed
 * with no Kid Device joined yet, cleared once it has shown the confirmation. It is a UI convenience
 * held on that phone, not onboarding state (spec #86), so a Partner's phone or a reinstall — which
 * never saw the step — confirms nothing, and a record the confirmation cleared never shows again.
 */
export function connectedOnOpen(
  awaitingChildId: string | null,
  me: { setup: Pick<SetupFacts, 'deviceEverJoined'>; children: readonly { id: string }[] },
): string | null {
  if (awaitingChildId === null || !me.setup.deviceEverJoined) return null;
  return me.children.some((c) => c.id === awaitingChildId) ? awaitingChildId : null;
}

/** Mibo's App Store listing, by App Store Connect's own numeric app id (`ascAppId` in eas.json). */
export const APP_STORE_URL = 'https://apps.apple.com/app/id6812645404';
/** Mibo's Google Play listing, by the Android package. */
export const PLAY_STORE_URL = 'https://play.google.com/store/apps/details?id=com.mibokids.app';

/**
 * What "Send the app link" shares: one line, then both store links. It takes no Join Code and so
 * can never carry one — a fifteen-minute, single-use code does not belong in a chat thread.
 */
export function appLinkMessage(line: string): string {
  return [line, `App Store: ${APP_STORE_URL}`, `Google Play: ${PLAY_STORE_URL}`].join('\n');
}
