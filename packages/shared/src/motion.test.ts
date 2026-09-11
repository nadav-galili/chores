import { describe, expect, it } from 'vitest';
import {
  COIN_COUNT_UP_MS,
  countUpCoins,
  doneHaptic,
  finishesTheDay,
  type TappedItem,
} from './motion.ts';

describe('doneHaptic', () => {
  it('buzzes medium on a completion', () => {
    expect(doneHaptic({ completed: true, dayComplete: false })).toBe('medium');
  });

  it('answers a Day Complete with the stronger success notification instead', () => {
    expect(doneHaptic({ completed: true, dayComplete: true })).toBe('success');
  });

  it('says nothing on an undo', () => {
    expect(doneHaptic({ completed: false, dayComplete: false })).toBe(null);
  });

  it('says nothing when an undo happens to leave a complete day behind', () => {
    expect(doneHaptic({ completed: false, dayComplete: true })).toBe(null);
  });
});

describe('finishesTheDay', () => {
  const items = (...statuses: TappedItem['status'][]): TappedItem[] =>
    statuses.map((status, i) => ({ id: `i${i}`, status }));

  it('is true for the last chore still due', () => {
    expect(finishesTheDay(items('done', 'done', 'due'), 'i2')).toBe(true);
  });

  it('is false while another chore is still due', () => {
    expect(finishesTheDay(items('done', 'due', 'due'), 'i2')).toBe(false);
  });

  it('is true for the only chore of the day', () => {
    expect(finishesTheDay(items('due'), 'i0')).toBe(true);
  });

  it('counts a chore waiting on a photo or a redo as still due', () => {
    expect(finishesTheDay(items('pending_photo', 'due'), 'i1')).toBe(false);
    expect(finishesTheDay(items('redo', 'due'), 'i1')).toBe(false);
  });

  it('is false when the tapped chore was already done — an undo finishes nothing', () => {
    expect(finishesTheDay(items('done', 'done'), 'i1')).toBe(false);
  });

  it('is false when the tapped chore is not on the list', () => {
    expect(finishesTheDay(items('done'), 'gone')).toBe(false);
  });

  it('is false with nothing due at all — a frozen day is not completed by a tap', () => {
    expect(finishesTheDay([], 'i0')).toBe(false);
  });
});

describe('countUpCoins', () => {
  it('starts at the old balance and ends exactly at the new one', () => {
    expect(countUpCoins(10, 20, 0)).toBe(10);
    expect(countUpCoins(10, 20, COIN_COUNT_UP_MS)).toBe(20);
    expect(countUpCoins(10, 20, COIN_COUNT_UP_MS * 2)).toBe(20);
  });

  it('passes through the numbers in between rather than jumping', () => {
    const half = countUpCoins(0, 100, COIN_COUNT_UP_MS / 2);
    expect(half).toBeGreaterThan(0);
    expect(half).toBeLessThan(100);
  });

  it('only ever rises, and never past the new balance', () => {
    let last = 0;
    for (let ms = 0; ms <= COIN_COUNT_UP_MS; ms += 16) {
      const now = countUpCoins(0, 37, ms);
      expect(now).toBeGreaterThanOrEqual(last);
      expect(now).toBeLessThanOrEqual(37);
      last = now;
    }
  });

  it('counts in whole coins', () => {
    for (let ms = 0; ms <= COIN_COUNT_UP_MS; ms += 7) {
      expect(Number.isInteger(countUpCoins(0, 13, ms))).toBe(true);
    }
  });

  it('snaps to a balance that fell — an undo is not a celebration', () => {
    expect(countUpCoins(20, 10, 0)).toBe(10);
    expect(countUpCoins(20, 20, 0)).toBe(20);
  });

  it('snaps rather than dividing by a duration of zero', () => {
    expect(countUpCoins(0, 5, 0, 0)).toBe(5);
  });
});
