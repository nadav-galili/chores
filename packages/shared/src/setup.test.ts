import { describe, expect, it } from 'vitest';
import { nextSetupStep, type SetupFacts } from './setup.ts';

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
