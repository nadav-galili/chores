import { describe, expect, it } from 'vitest';
import { formatChoreDate, formatNumber, formatWallClock, weekdayLabels } from './format.ts';

describe('formatChoreDate', () => {
  it('reads the calendar day out in the locale', () => {
    expect(formatChoreDate('en', '2026-09-12')).toBe('12 Sept 2026');
    expect(formatChoreDate('he', '2026-09-12')).toBe('12 בספט׳ 2026');
  });

  it('never lets a timezone move the day', () => {
    // A chore date is a household-local day, not an instant: the first and last day of a month
    // must read as themselves wherever the phone happens to be.
    for (const tz of ['Pacific/Kiritimati', 'Pacific/Midway']) {
      process.env.TZ = tz;
      expect(formatChoreDate('en', '2026-01-01')).toBe('1 Jan 2026');
      expect(formatChoreDate('en', '2026-12-31')).toBe('31 Dec 2026');
    }
    delete process.env.TZ;
  });
});

describe('formatWallClock', () => {
  it('is the household’s clock, 24 hours, in both locales', () => {
    const instant = '2026-09-09T13:05:00.000Z';
    expect(formatWallClock('en', instant, 'Asia/Jerusalem')).toBe('16:05');
    expect(formatWallClock('he', instant, 'Asia/Jerusalem')).toBe('16:05');
    expect(formatWallClock('en', instant, 'America/New_York')).toBe('09:05');
  });
});

describe('weekdayLabels', () => {
  it('is Monday first, one label per mask bit', () => {
    expect(weekdayLabels('en')).toEqual(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);
    expect(weekdayLabels('he')).toEqual(['ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳', 'א׳']);
  });
});

describe('formatNumber', () => {
  it('groups digits the way the locale does', () => {
    expect(formatNumber('en', 1234)).toBe('1,234');
    expect(formatNumber('he', 1234)).toBe('1,234');
    expect(formatNumber('he', 7)).toBe('7');
  });
});
