import { describe, expect, it } from 'vitest';
import {
  digestCopy,
  digestWorthSending,
  expoPushTokenSchema,
  isDayComplete,
  notificationId,
  notificationKindSchema,
  openedNotificationDestination,
  openedNotificationKind,
  notificationTargetSchema,
  parentDeviceId,
  parentDeviceInputSchema,
  redemptionRequestedCopy,
  rewardApprovedCopy,
  type DigestSummary,
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

describe('openedNotificationKind', () => {
  it('reads back the kind of every notification this app sends', () => {
    for (const kind of notificationKindSchema.options) {
      expect(openedNotificationKind({ kind })).toBe(kind);
    }
  });

  it('takes the kind and leaves the rest of the payload where it is (ADR-0009)', () => {
    const tapped = {
      kind: 'redemption_requested',
      redemption_id: 'cccccccc-0000-4000-8000-000000000001',
      child_first_name: 'Noa',
    };
    expect(openedNotificationKind(tapped)).toBe('redemption_requested');
  });

  it('is nothing at all for a payload that names no kind of ours', () => {
    for (const data of [undefined, null, {}, 'kid_reminder', { kind: 'something_later' }]) {
      expect(openedNotificationKind(data)).toBeNull();
    }
  });
});

describe('openedNotificationDestination', () => {
  const redemption = 'cccccccc-0000-4000-8000-000000000001';

  it('takes a request to the parent\u2019s day with the request it is about named', () => {
    expect(
      openedNotificationDestination({
        kind: 'redemption_requested',
        redemption_id: redemption,
        path: '/(parent)',
      }),
    ).toEqual({ path: '/(parent)', audience: 'parent', params: { redemption } });
  });

  it('takes an approval to the child\u2019s shop', () => {
    expect(
      openedNotificationDestination({
        kind: 'reward_approved',
        child_id: noa,
        redemption_id: redemption,
        path: '/(kid)/shop',
      }),
    ).toEqual({ path: '/(kid)/shop', audience: 'kid', params: { redemption } });
  });

  it('takes a digest to the parent\u2019s day, which is the day it is about', () => {
    expect(
      openedNotificationDestination({
        kind: 'parent_digest',
        chore_date: '2026-03-01',
        path: '/(parent)',
      }),
    ).toEqual({ path: '/(parent)', audience: 'parent', params: {} });
  });

  it('is nothing at all for a payload naming no path of ours', () => {
    for (const data of [
      undefined,
      null,
      {},
      'path',
      { kind: 'kid_reminder' },
      { path: '/(parent)/pin' },
      { path: '../../(parent)' },
      { path: 'https://example.com' },
    ]) {
      expect(openedNotificationDestination(data)).toBeNull();
    }
  });

  it('passes on an id only when it is one, so nothing off a payload can shape a route', () => {
    for (const bad of ['', 'not-a-uuid', '../oops', 42, null, { id: noa }]) {
      expect(
        openedNotificationDestination({ path: '/(parent)', redemption_id: bad })?.params,
      ).toEqual({});
    }
  });
});

describe('the immediate kinds’ copy', () => {
  it('is written in both languages, and says nothing about a child', () => {
    for (const copy of [
      redemptionRequestedCopy('en'),
      redemptionRequestedCopy('he'),
      rewardApprovedCopy('en'),
      rewardApprovedCopy('he'),
    ]) {
      expect(copy.title.length).toBeGreaterThan(0);
      expect(copy.body.length).toBeGreaterThan(0);
      // A push travels through Expo, so a first name or a reward title in one would be something
      // about a child reaching a third party (ADR-0009). The copy takes no arguments at all —
      // that is what keeps it true, rather than remembering not to interpolate one.
      expect(`${copy.title} ${copy.body}`).not.toMatch(/%\{/);
    }
  });

  it('is not the same words in the two languages, or for the two kinds', () => {
    expect(redemptionRequestedCopy('he')).not.toEqual(redemptionRequestedCopy('en'));
    expect(rewardApprovedCopy('he')).not.toEqual(rewardApprovedCopy('en'));
    expect(rewardApprovedCopy('en')).not.toEqual(redemptionRequestedCopy('en'));
  });
});

describe('digestWorthSending', () => {
  const summary = (children: DigestSummary['children'], undecided = 0): DigestSummary => ({
    children,
    undecided_redemptions: undecided,
  });

  it('is nothing at all on a day with nothing due and nothing waiting', () => {
    expect(digestWorthSending(summary([]))).toBe(false);
    expect(digestWorthSending(summary([{ first_name: 'Noa', due_count: 0, done_count: 0 }]))).toBe(
      false,
    );
  });

  it('is worth sending when a chore was due, done or not', () => {
    expect(digestWorthSending(summary([{ first_name: 'Noa', due_count: 4, done_count: 0 }]))).toBe(
      true,
    );
    expect(digestWorthSending(summary([{ first_name: 'Noa', due_count: 4, done_count: 4 }]))).toBe(
      true,
    );
  });

  it('is worth sending for a waiting request on a day with nothing due', () => {
    expect(
      digestWorthSending(summary([{ first_name: 'Noa', due_count: 0, done_count: 0 }], 1)),
    ).toBe(true);
  });
});

describe('isDayComplete', () => {
  it('is every instance of the day done, and never a day with nothing in it', () => {
    expect(isDayComplete({ first_name: 'Noa', due_count: 4, done_count: 4 })).toBe(true);
    expect(isDayComplete({ first_name: 'Noa', due_count: 4, done_count: 3 })).toBe(false);
    expect(isDayComplete({ first_name: 'Noa', due_count: 0, done_count: 0 })).toBe(false);
  });
});

describe('digestCopy', () => {
  const day: DigestSummary = {
    children: [
      { first_name: 'Noa', due_count: 4, done_count: 3 },
      { first_name: 'Ori', due_count: 2, done_count: 2 },
    ],
    undecided_redemptions: 0,
  };

  it('counts what is done, because the day is not over', () => {
    const { title, body } = digestCopy('en', day);
    expect(title).toBe('Today so far');
    expect(body).toContain('Noa 3/4 done');
    // The day is still open: nothing in the digest may say a child failed to finish it.
    expect(body.toLowerCase()).not.toContain('did not');
    expect(body.toLowerCase()).not.toContain('missed');
  });

  it('says who is Day Complete', () => {
    expect(digestCopy('en', day).body).toContain('Ori 2/2 done — all done');
  });

  it('names a child with nothing due rather than reading 0/0', () => {
    const { body } = digestCopy('en', {
      children: [{ first_name: 'Noa', due_count: 0, done_count: 0 }],
      undecided_redemptions: 1,
    });
    expect(body).toContain('Noa — nothing due');
    expect(body).not.toContain('0/0');
  });

  it('counts the waiting requests only when there are any', () => {
    expect(digestCopy('en', day).body).not.toContain('waiting');
    expect(digestCopy('en', { ...day, undecided_redemptions: 1 }).body).toContain(
      '1 reward is waiting for you',
    );
    expect(digestCopy('en', { ...day, undecided_redemptions: 3 }).body).toContain(
      '3 rewards are waiting for you',
    );
  });

  it('speaks Hebrew', () => {
    const { title, body } = digestCopy('he', { ...day, undecided_redemptions: 2 });
    expect(title).toBe('היום עד עכשיו');
    expect(body).toContain('Noa 3/4 בוצעו');
    expect(body).toContain('Ori 2/2 בוצעו — הכול בוצע');
    expect(body).toContain('שני פרסים ממתינים להחלטה שלך');
  });
});
