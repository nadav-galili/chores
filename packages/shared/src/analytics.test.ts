import { describe, expect, it } from 'vitest';
import {
  ANALYTICS_HOST,
  ageBand,
  choreCreated,
  choreCompleted,
  groveGrew,
  householdCreated,
  householdHash,
  joinCodeRedeemed,
  kidAppOpen,
  kidDayComplete,
  kidProperties,
  parentIdentity,
  petReacted,
  pushOpened,
  redemptionDecided,
  rewardRequested,
  type AnalyticsEvent,
} from './analytics.ts';
import { notificationKindSchema } from './notification.ts';

const child = {
  id: '018f0c2e-1111-7000-8000-000000000001',
  first_name: 'Noa',
  ui_mode: 'little' as const,
  pet_name: 'Pip',
};
const householdId = '018f0c2e-2222-7000-8000-000000000002';
/** What a reward is called is a parent's own words; only its catalog key may cross (ADR-0009). */
const rewardTitle = 'Ice cream after swimming';

describe('the host', () => {
  it('is the EU one, because that is where this project lives (ADR-0009)', () => {
    expect(ANALYTICS_HOST).toBe('https://eu.i.posthog.com');
  });
});

describe('ageBand', () => {
  it('is the only age signal the product holds: the ui mode a parent chose', () => {
    expect(ageBand('little')).toBe('5-7');
    expect(ageBand('big')).toBe('8+');
  });
});

describe('householdHash', () => {
  it('is stable for one household and different for another', () => {
    expect(householdHash(householdId)).toBe(householdHash(householdId));
    expect(householdHash(householdId)).not.toBe(householdHash(child.id));
  });

  it('is not the household id itself, so the analytics store never holds one', () => {
    expect(householdHash(householdId)).not.toBe(householdId);
  });
});

describe('kidProperties', () => {
  it('is ui mode, age band and household hash, and nothing else', () => {
    const props = kidProperties({ ui_mode: 'big', household_id: householdId });
    expect(Object.keys(props).sort()).toEqual(['age_band', 'household_hash', 'ui_mode']);
    expect(props).toMatchObject({ ui_mode: 'big', age_band: '8+' });
  });
});

describe('parentIdentity', () => {
  it('identifies the Clerk user and groups them by household', () => {
    expect(parentIdentity('user_abc', householdId)).toEqual({
      distinct_id: 'user_abc',
      groups: { household: householdId },
    });
  });

  it('groups by nothing before the parent has a household', () => {
    expect(parentIdentity('user_abc', null)).toEqual({ distinct_id: 'user_abc', groups: {} });
  });
});

describe('the events', () => {
  it('names the activation events the milestone asks about', () => {
    expect(householdCreated({ currency: 'ILS', tz: 'Asia/Jerusalem' }).event).toBe(
      'household_created',
    );
    expect(choreCreated({ kind: 'daily', assignee_count: 2 }).event).toBe('chore_created');
    expect(
      joinCodeRedeemed({ ui_mode: child.ui_mode, household_id: householdId, platform: 'android' })
        .event,
    ).toBe('join_code_redeemed');
  });

  it('names the kid loop events the milestone asks about', () => {
    expect(kidAppOpen().event).toBe('kid_app_open');
    expect(choreCompleted({ offline: true }).properties).toEqual({ offline: true });
    expect(petReacted({ tapped_at: 1000, shown_at: 1120 }).properties).toEqual({ ms: 120 });
    expect(kidDayComplete({ streak: 3 }).event).toBe('kid_day_complete');
    expect(groveGrew({ stage: 4 }).properties).toEqual({ stage: 4 });
  });

  it('names what a child asked for by its catalog key and its price, and nothing else', () => {
    const asked = rewardRequested({ builtin_key: 'screen_time', cost_coins: 150 });
    expect(asked.event).toBe('reward_requested');
    expect(asked.properties).toEqual({ builtin_key: 'screen_time', cost_coins: 150 });
  });

  it('reports a decided redemption as the decision alone, never what was asked for', () => {
    expect(redemptionDecided({ decision: 'declined' })).toEqual({
      event: 'redemption_decided',
      properties: { decision: 'declined' },
    });
  });

  it('reports a tapped notification as its kind alone, whichever kind it was', () => {
    expect(pushOpened({ kind: 'parent_digest' })).toEqual({
      event: 'push_opened',
      properties: { kind: 'parent_digest' },
    });
    for (const kind of notificationKindSchema.options) {
      expect(pushOpened({ kind }).properties).toEqual({ kind });
    }
  });

  it('never reports a pet reaction as having happened before the tap', () => {
    expect(petReacted({ tapped_at: 1000, shown_at: 900 }).properties).toEqual({ ms: 0 });
  });
});

describe('what an event may carry', () => {
  /** Every event this app can send, built from a child whose every identifier is distinctive. */
  const everyEvent = (): AnalyticsEvent[] => [
    householdCreated({ currency: 'ILS', tz: 'Asia/Jerusalem' }),
    choreCreated({ kind: 'daily', assignee_count: 2 }),
    joinCodeRedeemed({ ui_mode: child.ui_mode, household_id: householdId, platform: 'android' }),
    kidAppOpen(),
    choreCompleted({ offline: false }),
    petReacted({ tapped_at: 1000, shown_at: 1120 }),
    kidDayComplete({ streak: 3 }),
    groveGrew({ stage: 4 }),
    rewardRequested({ builtin_key: 'snack', cost_coins: 50 }),
    redemptionDecided({ decision: 'approved' }),
    ...notificationKindSchema.options.map((kind) => pushOpened({ kind })),
  ];

  it('is never the child id, their first name, their pet name or a reward title (ADR-0009)', () => {
    const forbidden = [child.id, child.first_name, child.pet_name, householdId, rewardTitle];
    for (const event of everyEvent()) {
      const wire = JSON.stringify(event);
      for (const secret of forbidden) expect(wire).not.toContain(secret);
    }
  });

  it('carries, on the one event a device sends about itself, only what it is allowed to say', () => {
    const redeemed = joinCodeRedeemed({
      ui_mode: child.ui_mode,
      household_id: householdId,
      platform: 'android',
    });
    expect(Object.keys(redeemed.properties).sort()).toEqual([
      'age_band',
      'household_hash',
      'platform',
      'ui_mode',
    ]);
  });
});
