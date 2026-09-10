import { describe, expect, it } from 'vitest';
import { DEFAULT_LOCALE, LOCALES, isRtl, localeSchema, pickLocale } from './locale.ts';
import { kidReminderCopy } from './notification.ts';

describe('locales', () => {
  it('is English by default and Hebrew as the tested second locale', () => {
    expect(LOCALES).toEqual(['en', 'he']);
    expect(DEFAULT_LOCALE).toBe('en');
    expect(localeSchema.options).toEqual(['en', 'he']);
  });

  it('lays Hebrew out right to left and English left to right', () => {
    expect(isRtl('he')).toBe(true);
    expect(isRtl('en')).toBe(false);
  });
});

describe('pickLocale', () => {
  it('takes the phone’s first supported language', () => {
    expect(pickLocale(['he-IL', 'en-US'])).toBe('he');
    expect(pickLocale(['en-GB'])).toBe('en');
    expect(pickLocale(['he'])).toBe('he');
  });

  it('skips languages we do not have and falls back to English', () => {
    expect(pickLocale(['ru-RU', 'he-IL'])).toBe('he');
    expect(pickLocale(['ru-RU', 'ar-SA'])).toBe('en');
    expect(pickLocale([])).toBe('en');
    expect(pickLocale([null, undefined, 'he'])).toBe('he');
  });

  it('reads the old Hebrew tag Android still hands out', () => {
    expect(pickLocale(['iw-IL'])).toBe('he');
  });
});

describe('kidReminderCopy', () => {
  it('says the same thing in both locales, and nothing empty', () => {
    for (const locale of LOCALES) {
      const copy = kidReminderCopy(locale);
      expect(copy.title.length).toBeGreaterThan(0);
      expect(copy.body.length).toBeGreaterThan(0);
    }
    expect(kidReminderCopy('en')).not.toEqual(kidReminderCopy('he'));
  });
});
