import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { hashPin, pinSchema } from './pin.ts';

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
