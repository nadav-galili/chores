import { describe, expect, it } from 'vitest';
import {
  JOIN_CODE_ALPHABET,
  JOIN_CODE_TTL_MS,
  generateJoinCode,
  joinCodeSchema,
  joinCodeStatus,
  deviceSessionSchema,
  redeemJoinCodeInputSchema,
} from './join-code.ts';

describe('generateJoinCode', () => {
  it('is 6 chars from an alphabet without look-alikes', () => {
    const code = generateJoinCode(() => 0.5);
    expect(code).toHaveLength(6);
    for (const ch of code) expect(JOIN_CODE_ALPHABET).toContain(ch);
    for (const ch of '01OIL') expect(JOIN_CODE_ALPHABET).not.toContain(ch);
  });

  it('maps the random source across the whole alphabet', () => {
    expect(generateJoinCode(() => 0)).toBe(JOIN_CODE_ALPHABET[0]!.repeat(6));
    expect(generateJoinCode(() => 0.999999)).toBe(JOIN_CODE_ALPHABET.at(-1)!.repeat(6));
  });
});

describe('joinCodeSchema', () => {
  it('normalizes what a child types: trims, uppercases, strips spaces and dashes', () => {
    expect(joinCodeSchema.parse(' abc-d ef ')).toBe('ABCDEF');
  });

  it('rejects wrong lengths and characters outside the alphabet', () => {
    expect(joinCodeSchema.safeParse('ABCDE').success).toBe(false);
    expect(joinCodeSchema.safeParse('ABCDEFG').success).toBe(false);
    expect(joinCodeSchema.safeParse('ABC0EF').success).toBe(false);
  });
});

describe('joinCodeStatus', () => {
  const now = new Date('2026-09-09T10:00:00Z');
  const live = { expiresAt: new Date('2026-09-09T10:15:00Z'), redeemedAt: null };

  it('is live before expiry and unredeemed', () => {
    expect(joinCodeStatus(live, now)).toBe('live');
  });

  it('is expired at and after expires_at', () => {
    expect(joinCodeStatus(live, live.expiresAt)).toBe('expired');
    expect(joinCodeStatus(live, new Date('2026-09-10T00:00:00Z'))).toBe('expired');
  });

  it('is redeemed once redeemed, even if still within the window', () => {
    expect(joinCodeStatus({ ...live, redeemedAt: now }, now)).toBe('redeemed');
  });

  it('expires 15 minutes after issue', () => {
    expect(JOIN_CODE_TTL_MS).toBe(15 * 60 * 1000);
  });
});

describe('redeemJoinCodeInputSchema', () => {
  it('accepts a code and a platform', () => {
    expect(redeemJoinCodeInputSchema.parse({ code: 'abcdef', platform: 'android' })).toEqual({
      code: 'ABCDEF',
      platform: 'android',
    });
  });
  it('rejects unknown platforms', () => {
    expect(redeemJoinCodeInputSchema.safeParse({ code: 'ABCDEF', platform: 'web' }).success).toBe(
      false,
    );
  });
});

describe('deviceSessionSchema', () => {
  it('is what a kid device stores after redeeming', () => {
    const session = {
      device_id: '019906c0-0000-7000-8000-000000000001',
      device_token: 'tok',
      analytics_anon_id: '4b7a9c1e-1234-4567-8901-abcdefabcdef',
      child: {
        id: '019906c0-0000-7000-8000-000000000002',
        first_name: 'Noa',
        ui_mode: 'little',
        pet_name: 'Pip',
      },
      household: {
        id: '019906c0-0000-7000-8000-000000000003',
        tz: 'Asia/Jerusalem',
        day_boundary_hour: 0,
        entitlement: 'premium',
      },
    };
    expect(deviceSessionSchema.parse(session)).toEqual(session);
  });

  it('loads an older stored session as free until /device/me refreshes it', () => {
    const parsed = deviceSessionSchema.parse({
      device_id: '019906c0-0000-7000-8000-000000000001',
      device_token: 'tok',
      analytics_anon_id: '4b7a9c1e-1234-4567-8901-abcdefabcdef',
      child: {
        id: '019906c0-0000-7000-8000-000000000002',
        first_name: 'Noa',
        ui_mode: 'little',
        pet_name: 'Pip',
      },
      household: {
        id: '019906c0-0000-7000-8000-000000000003',
        tz: 'Asia/Jerusalem',
        day_boundary_hour: 0,
      },
    });
    expect(parsed.household.entitlement).toBe('free');
  });
});
