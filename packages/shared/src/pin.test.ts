import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  afterWrongPin,
  hashPin,
  NO_PIN_ATTEMPTS,
  PIN_COOLDOWN_MS,
  PIN_MAX_ATTEMPTS,
  pinCooldownMsLeft,
  pinSchema,
  verifyPin,
} from './pin.ts';

const nodeHash = (salt: string, pin: string) =>
  createHash('sha256')
    .update(salt + pin)
    .digest('hex');

describe('pinSchema', () => {
  it('takes four digits', () => {
    expect(pinSchema.safeParse('0000').success).toBe(true);
    expect(pinSchema.safeParse('9317').success).toBe(true);
  });

  it('refuses anything else', () => {
    for (const bad of ['123', '12345', '12a4', '', ' 1234', '١٢٣٤']) {
      expect(pinSchema.safeParse(bad).success).toBe(false);
    }
  });
});

describe('hashPin', () => {
  it('is SHA-256 of the salt followed by the pin', () => {
    expect(hashPin('a3f1', '1234')).toBe(nodeHash('a3f1', '1234'));
  });

  it('agrees with node across block boundaries', () => {
    for (const salt of ['', '0'.repeat(32), 'f'.repeat(55), 'e'.repeat(56), 'd'.repeat(200)]) {
      expect(hashPin(salt, '9999')).toBe(nodeHash(salt, '9999'));
    }
  });

  it('separates households that share a pin', () => {
    expect(hashPin('aaaa', '1234')).not.toBe(hashPin('bbbb', '1234'));
  });
});

describe('verifyPin', () => {
  const salt = 'c0ffee';
  const hash = hashPin(salt, '4271');

  it('opens for the right pin and for nothing else', () => {
    expect(verifyPin(hash, salt, '4271')).toBe(true);
    for (const wrong of ['4272', '1234', '0000']) expect(verifyPin(hash, salt, wrong)).toBe(false);
  });

  it('refuses anything that is not four digits, without hashing it', () => {
    for (const bad of ['', '427', '42710', '427a', ' 4271']) {
      expect(verifyPin(hash, salt, bad)).toBe(false);
    }
  });

  it('refuses everything while the device holds no pin', () => {
    expect(verifyPin(null, salt, '4271')).toBe(false);
    expect(verifyPin(hash, null, '4271')).toBe(false);
    expect(verifyPin(undefined, undefined, '4271')).toBe(false);
  });

  it('does not open for another household’s pin', () => {
    expect(verifyPin(hashPin('other', '4271'), salt, '4271')).toBe(false);
  });
});

describe('the attempt limit', () => {
  const now = 1_700_000_000_000;

  it('counts wrong tries and starts a cooldown on the fifth', () => {
    let attempts = NO_PIN_ATTEMPTS;
    for (let i = 1; i < PIN_MAX_ATTEMPTS; i++) {
      attempts = afterWrongPin(attempts, now);
      expect(attempts.wrong).toBe(i);
      expect(pinCooldownMsLeft(attempts, now)).toBe(0);
    }
    attempts = afterWrongPin(attempts, now);
    expect(pinCooldownMsLeft(attempts, now)).toBe(PIN_COOLDOWN_MS);
  });

  it('lifts the cooldown when the minute is up, and counts from zero behind it', () => {
    let attempts = NO_PIN_ATTEMPTS;
    for (let i = 0; i < PIN_MAX_ATTEMPTS; i++) attempts = afterWrongPin(attempts, now);
    expect(pinCooldownMsLeft(attempts, now + PIN_COOLDOWN_MS - 1)).toBe(1);
    expect(pinCooldownMsLeft(attempts, now + PIN_COOLDOWN_MS)).toBe(0);
    expect(attempts.wrong).toBe(0);
    expect(pinCooldownMsLeft(afterWrongPin(attempts, now + PIN_COOLDOWN_MS), now)).toBe(0);
  });

  it('is open with no attempts recorded', () => {
    expect(pinCooldownMsLeft(NO_PIN_ATTEMPTS, now)).toBe(0);
  });
});
