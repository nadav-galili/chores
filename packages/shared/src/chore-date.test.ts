import { describe, expect, it } from 'vitest';
import { choreDate } from './chore-date.ts';

const at = (iso: string) => new Date(iso);

describe('choreDate', () => {
  describe('Asia/Jerusalem', () => {
    const tz = 'Asia/Jerusalem';

    it('boundary 0: the chore date flips at local midnight (IDT, UTC+3)', () => {
      expect(choreDate(at('2026-06-14T20:59:59Z'), tz, 0)).toBe('2026-06-14');
      expect(choreDate(at('2026-06-14T21:00:00Z'), tz, 0)).toBe('2026-06-15');
    });

    it('boundary 3: a 02:59 completion still counts for the previous chore date', () => {
      expect(choreDate(at('2026-06-14T23:59:59Z'), tz, 3)).toBe('2026-06-14');
      expect(choreDate(at('2026-06-15T00:00:00Z'), tz, 3)).toBe('2026-06-15');
    });

    it('spring forward (2026-03-27 02:00 IST → 03:00 IDT), boundary 0', () => {
      expect(choreDate(at('2026-03-26T21:59:59Z'), tz, 0)).toBe('2026-03-26');
      expect(choreDate(at('2026-03-26T22:00:00Z'), tz, 0)).toBe('2026-03-27');
      // 03:00 IDT, the first instant after the gap
      expect(choreDate(at('2026-03-27T00:00:00Z'), tz, 0)).toBe('2026-03-27');
    });

    it('spring forward, boundary 3: the boundary is three clock hours after midnight', () => {
      // 03:00 IDT = 3h after 00:00 IST only on the wall clock; the instant is 2h later
      expect(choreDate(at('2026-03-27T00:00:00Z'), tz, 3)).toBe('2026-03-26');
      // 04:00 IDT: three real hours after local midnight
      expect(choreDate(at('2026-03-27T01:00:00Z'), tz, 3)).toBe('2026-03-27');
    });

    it('fall back (2026-10-25 02:00 IDT → 01:00 IST), boundary 0', () => {
      expect(choreDate(at('2026-10-24T20:59:59Z'), tz, 0)).toBe('2026-10-24');
      expect(choreDate(at('2026-10-24T21:00:00Z'), tz, 0)).toBe('2026-10-25');
      // 01:30 IST, inside the repeated hour
      expect(choreDate(at('2026-10-24T23:30:00Z'), tz, 0)).toBe('2026-10-25');
    });

    it('fall back, boundary 3: the repeated hour stays on the previous chore date', () => {
      expect(choreDate(at('2026-10-24T23:30:00Z'), tz, 3)).toBe('2026-10-24');
      expect(choreDate(at('2026-10-25T00:00:00Z'), tz, 3)).toBe('2026-10-25');
    });
  });

  describe('America/New_York', () => {
    const tz = 'America/New_York';

    it('boundary 0: flips at local midnight on both sides of spring forward (2026-03-08)', () => {
      expect(choreDate(at('2026-03-08T04:59:59Z'), tz, 0)).toBe('2026-03-07');
      expect(choreDate(at('2026-03-08T05:00:00Z'), tz, 0)).toBe('2026-03-08');
      expect(choreDate(at('2026-03-09T03:59:59Z'), tz, 0)).toBe('2026-03-08');
      expect(choreDate(at('2026-03-09T04:00:00Z'), tz, 0)).toBe('2026-03-09');
    });

    it('boundary 3 on spring forward day, when 03:00 does not exist', () => {
      // 03:00 EDT is the instant right after 01:59:59 EST
      expect(choreDate(at('2026-03-08T07:00:00Z'), tz, 3)).toBe('2026-03-07');
      // 04:00 EDT
      expect(choreDate(at('2026-03-08T08:00:00Z'), tz, 3)).toBe('2026-03-08');
    });

    it('boundary 3 on fall back day (2026-11-01), when 01:00 happens twice', () => {
      // 01:59:59 EST (second pass)
      expect(choreDate(at('2026-11-01T06:59:59Z'), tz, 3)).toBe('2026-10-31');
      // 02:00 EST
      expect(choreDate(at('2026-11-01T07:00:00Z'), tz, 3)).toBe('2026-11-01');
    });

    it('boundary 0 on an ordinary day', () => {
      expect(choreDate(at('2026-09-09T03:59:59Z'), tz, 0)).toBe('2026-09-08');
      expect(choreDate(at('2026-09-09T04:00:00Z'), tz, 0)).toBe('2026-09-09');
    });
  });

  it('rejects a day boundary outside 0-6', () => {
    expect(() => choreDate(at('2026-09-09T00:00:00Z'), 'Asia/Jerusalem', 7)).toThrow(RangeError);
    expect(() => choreDate(at('2026-09-09T00:00:00Z'), 'Asia/Jerusalem', -1)).toThrow(RangeError);
  });

  it('rejects an unknown timezone', () => {
    expect(() => choreDate(at('2026-09-09T00:00:00Z'), 'Mars/Olympus', 0)).toThrow(RangeError);
  });
});
