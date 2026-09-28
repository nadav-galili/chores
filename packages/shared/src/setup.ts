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
