import { describe, expect, it } from 'vitest';
import { uuid7 } from './uuid7.ts';

const V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('uuid7', () => {
  it('is an RFC 9562 version 7 uuid', () => {
    expect(uuid7()).toMatch(V7);
  });

  it('embeds the millisecond timestamp in the first 48 bits', () => {
    // 2026-09-09T00:00:00Z = 1788912000000 ms = 0x01a08376dc00
    const id = uuid7(new Date('2026-09-09T00:00:00Z'));
    expect(id.slice(0, 13)).toBe('01a08376-dc00');
  });

  it('never repeats', () => {
    const ids = new Set(Array.from({ length: 1000 }, () => uuid7()));
    expect(ids.size).toBe(1000);
  });
});
