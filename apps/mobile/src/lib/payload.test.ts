import { describe, expect, it } from 'vitest';
import { requireArrays } from './payload';

/**
 * The regression: a today payload from a server that predates `redemptions` used to reach the
 * screen, which read `.length` off `undefined` and killed the process.
 */
describe('requireArrays', () => {
  const fields = ['children', 'redemptions'] as const;

  it('passes a payload through when every list is there', () => {
    const payload = { chore_date: '2026-09-12', children: [], redemptions: [] };
    expect(requireArrays(payload, fields, 'today')).toBe(payload);
  });

  it('names the field an out-of-date server left out', () => {
    const payload = { chore_date: '2026-09-12', children: [] } as unknown as {
      children: unknown[];
      redemptions: unknown[];
    };
    expect(() => requireArrays(payload, fields, 'today')).toThrow(/today is missing redemptions/);
  });

  it('names every missing field at once', () => {
    expect(() => requireArrays({} as { children: unknown[]; redemptions: unknown[] }, fields, 'today')).toThrow(
      /children, redemptions/,
    );
  });

  it('refuses a field that is present but not a list', () => {
    const payload = { children: [], redemptions: null } as unknown as {
      children: unknown[];
      redemptions: unknown[];
    };
    expect(() => requireArrays(payload, fields, 'today')).toThrow(/redemptions/);
  });
});
