import { describe, expect, it } from 'vitest';
import {
  APP_STORE_URL,
  appLinkMessage,
  connectedOnOpen,
  nextSetupStep,
  PLAY_STORE_URL,
  setupStepOnSignIn,
  type MeSetup,
  type SetupFacts,
} from './setup.ts';

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

describe('connectedOnOpen', () => {
  const waiting = { setup: { deviceEverJoined: false }, children: [{ id: 'noa' }] };
  const joined = { setup: { deviceEverJoined: true }, children: [{ id: 'noa' }] };

  it('confirms the child this phone left waiting, once a Kid Device has joined', () => {
    expect(connectedOnOpen('noa', joined)).toBe('noa');
  });

  it('confirms nothing while the device has still not joined', () => {
    expect(connectedOnOpen('noa', waiting)).toBeNull();
  });

  it('confirms nothing without a record: another phone, a reinstall, or already confirmed', () => {
    expect(connectedOnOpen(null, joined)).toBeNull();
  });

  it('confirms nothing for a child who is no longer in the household', () => {
    expect(connectedOnOpen('gone', joined)).toBeNull();
  });
});

describe('appLinkMessage', () => {
  it('is the one line, then both store links', () => {
    const message = appLinkMessage('Get Mibo on your child’s device:');
    expect(message.split('\n')).toEqual([
      'Get Mibo on your child’s device:',
      `App Store: ${APP_STORE_URL}`,
      `Google Play: ${PLAY_STORE_URL}`,
    ]);
  });

  it('links the store listings of this app', () => {
    expect(APP_STORE_URL).toBe('https://apps.apple.com/app/id6812645404');
    expect(PLAY_STORE_URL).toBe('https://play.google.com/store/apps/details?id=com.mibokids.app');
  });
});
