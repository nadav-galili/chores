import { describe, expect, it } from 'vitest';
import {
  expoPushTokenSchema,
  notificationId,
  notificationKindSchema,
  notificationTargetSchema,
  parentDeviceId,
  parentDeviceInputSchema,
} from './notification.ts';
import { uuid5 } from './uuid5.ts';

const noa = 'aaaaaaaa-0000-4000-8000-000000000001';
const ori = 'aaaaaaaa-0000-4000-8000-000000000002';

describe('notificationKindSchema', () => {
  it('is exactly the four kinds the product allows', () => {
    expect(notificationKindSchema.options).toEqual([
      'kid_reminder',
      'parent_digest',
      'redemption_requested',
      'reward_approved',
    ]);
    expect(notificationTargetSchema.options).toEqual(['parent_device', 'child_device']);
  });
});

describe('notificationId', () => {
  it('is one id per kind, subject and key, whoever computes it', () => {
    expect(notificationId('kid_reminder', noa, '2026-09-09')).toBe(
      uuid5('notif', 'kid_reminder', noa, '2026-09-09'),
    );
    expect(notificationId('kid_reminder', noa, '2026-09-09')).toBe(
      notificationId('kid_reminder', noa, '2026-09-09'),
    );
  });

  it('separates subjects, days and kinds', () => {
    const id = notificationId('kid_reminder', noa, '2026-09-09');
    expect(notificationId('kid_reminder', ori, '2026-09-09')).not.toBe(id);
    expect(notificationId('kid_reminder', noa, '2026-09-10')).not.toBe(id);
    expect(notificationId('parent_digest', noa, '2026-09-09')).not.toBe(id);
  });
});

describe('expoPushTokenSchema', () => {
  it('takes the two shapes Expo issues', () => {
    expect(expoPushTokenSchema.safeParse('ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]').success).toBe(
      true,
    );
    expect(expoPushTokenSchema.safeParse('ExpoPushToken[yyyy]').success).toBe(true);
  });

  it('refuses anything else', () => {
    for (const bad of ['', 'nope', 'ExponentPushToken[]', 'fcm-token-1234']) {
      expect(expoPushTokenSchema.safeParse(bad).success).toBe(false);
    }
  });
});

describe('parentDeviceId', () => {
  const token = 'ExponentPushToken[parent-phone]';

  it('is the same id every time a parent re-registers the same token', () => {
    expect(parentDeviceId(noa, token)).toBe(uuid5('parent_device', noa, token));
  });

  it('scopes a token to its parent: the same token under two parents is two devices', () => {
    expect(parentDeviceId(noa, token)).not.toBe(parentDeviceId(ori, token));
  });

  it('is a new device when the token rotates', () => {
    expect(parentDeviceId(noa, token)).not.toBe(
      parentDeviceId(noa, 'ExponentPushToken[parent-phone-2]'),
    );
  });
});

describe('parentDeviceInputSchema', () => {
  it('takes a token, a platform and the language the parent reads', () => {
    const input = {
      expo_push_token: 'ExponentPushToken[parent-phone]',
      platform: 'ios',
      locale: 'he',
    };
    expect(parentDeviceInputSchema.parse(input)).toEqual(input);
  });

  it('refuses anything that is not one of ours', () => {
    const bad = [
      { expo_push_token: 'not-a-token', platform: 'ios', locale: 'he' },
      { expo_push_token: 'ExponentPushToken[a]', platform: 'web', locale: 'he' },
      { expo_push_token: 'ExponentPushToken[a]', platform: 'ios', locale: 'fr' },
      { expo_push_token: 'ExponentPushToken[a]', platform: 'ios' },
    ];
    for (const input of bad) expect(parentDeviceInputSchema.safeParse(input).success).toBe(false);
  });
});
