import { describe, expect, it } from 'vitest';
import { nextSetupStep, setupStepOnSignIn, type MeSetup, type SetupFacts } from './setup.ts';

const nothing: SetupFacts = {
  hasHousehold: false,
  childCount: 0,
  choreCount: 0,
  hasPin: false,
  deviceEverJoined: false,
};

describe('nextSetupStep', () => {
  it('walks household → child → chore → pin → join_code → done, first unmet fact first', () => {
    expect(nextSetupStep(nothing)).toBe('household');
    const household = { ...nothing, hasHousehold: true };
    expect(nextSetupStep(household)).toBe('child');
    const child = { ...household, childCount: 1 };
    expect(nextSetupStep(child)).toBe('chore');
    const chore = { ...child, choreCount: 1 };
    expect(nextSetupStep(chore)).toBe('pin');
    const pin = { ...chore, hasPin: true };
    expect(nextSetupStep(pin)).toBe('join_code');
    expect(nextSetupStep({ ...pin, deviceEverJoined: true })).toBe('done');
  });

  it('asks for the earliest missing fact even when later ones are met', () => {
    expect(nextSetupStep({ ...nothing, hasHousehold: true, hasPin: true, choreCount: 2 })).toBe(
      'child',
    );
  });

  it('is done forever once a Kid Device has joined, with no chore or no PIN left', () => {
    const joined = { hasHousehold: true, childCount: 1, deviceEverJoined: true };
    expect(nextSetupStep({ ...joined, choreCount: 0, hasPin: true })).toBe('done');
    expect(nextSetupStep({ ...joined, choreCount: 1, hasPin: false })).toBe('done');
    expect(nextSetupStep({ ...joined, choreCount: 0, hasPin: false })).toBe('done');
  });

  it('asks for a chore again when the only chores were deleted and no device has joined', () => {
    // `choreCount` counts non-deleted chores, so a household that deleted its only one reads zero.
    const deletedOnly = { ...nothing, hasHousehold: true, childCount: 1, hasPin: true };
    expect(nextSetupStep({ ...deletedOnly, choreCount: 0 })).toBe('chore');
  });
});

describe('setupStepOnSignIn', () => {
  const unfinished: MeSetup = {
    hasHousehold: true,
    childCount: 1,
    choreCount: 0,
    hasPin: false,
    deviceEverJoined: false,
    createdHousehold: true,
  };

  it('routes the parent who created the household into the first unfinished step', () => {
    expect(setupStepOnSignIn(unfinished)).toBe('chore');
    expect(setupStepOnSignIn({ ...unfinished, childCount: 0 })).toBe('child');
    expect(setupStepOnSignIn({ ...unfinished, choreCount: 1 })).toBe('pin');
    expect(setupStepOnSignIn({ ...unfinished, choreCount: 1, hasPin: true })).toBe('join_code');
  });

  it('never routes a Partner, who only sees the card', () => {
    expect(setupStepOnSignIn({ ...unfinished, createdHousehold: false })).toBeNull();
  });

  it('never routes once a Kid Device has joined, whatever else is missing', () => {
    expect(setupStepOnSignIn({ ...unfinished, deviceEverJoined: true })).toBeNull();
    expect(setupStepOnSignIn({ ...unfinished, childCount: 0, deviceEverJoined: true })).toBeNull();
  });

  it('leaves a parent with no household to the household form', () => {
    const none = { ...unfinished, hasHousehold: false, childCount: 0, createdHousehold: false };
    expect(setupStepOnSignIn(none)).toBeNull();
  });
});
