import { describe, expect, it } from 'vitest';
import { LOCALES } from '../locale.ts';
import { en } from './en.ts';
import { he } from './he.ts';

type Node = string | { [key: string]: Node };

/** Every leaf of a catalog as `a.b.c` → the string, so two catalogs can be compared key by key. */
function leaves(node: Node, prefix = ''): Record<string, string> {
  if (typeof node === 'string') return { [prefix]: node };
  return Object.entries(node).reduce<Record<string, string>>(
    (all, [key, value]) => Object.assign(all, leaves(value, prefix ? `${prefix}.${key}` : key)),
    {},
  );
}

const placeholders = (text: string) => [...text.matchAll(/%\{(\w+)\}/g)].map((m) => m[1]!).sort();

const CATALOGS = { en: leaves(en), he: leaves(he) };

describe('the catalogs', () => {
  it('cover every locale the app claims to speak', () => {
    expect(Object.keys(CATALOGS).sort()).toEqual([...LOCALES].sort());
  });

  it('say the same things: Hebrew is complete and invents nothing but its own plurals', () => {
    for (const key of Object.keys(CATALOGS.en)) expect(CATALOGS.he, key).toHaveProperty(key);
    // Hebrew carries plural forms English has no use for — `two` is `יומיים`, one word.
    const extra = Object.keys(CATALOGS.he).filter((key) => !(key in CATALOGS.en));
    expect(extra.every((key) => key.endsWith('.two'))).toBe(true);
  });

  it('has nothing blank or left in English', () => {
    for (const [key, value] of Object.entries(CATALOGS.he)) {
      expect(value.trim(), key).not.toBe('');
      // A Hebrew string with no Hebrew letter in it is a key nobody translated. Brand names and
      // symbols (Mibo, Google, XP, ₪) are allowed to ride along inside one.
      expect(/[֐-׿]/.test(value) || value === CATALOGS.en[key], key).toBe(true);
    }
  });

  it('interpolates the same values, so no screen can render a %{placeholder}', () => {
    for (const [key, english] of Object.entries(CATALOGS.en)) {
      const known = placeholders(english);
      // Hebrew may drop one — `one: 'יום אחד'` says the count in words — but never invent one.
      for (const name of placeholders(CATALOGS.he[key]!)) expect(known, key).toContain(name);
    }
  });

  // The third of the three `ui_mode` differences (docs/spec/06-design.md). Voice is otherwise
  // unfalsifiable, so it is pinned to the one part of it a test can hold: `big` never shouts.
  it('speaks to a 10-year-old without exclamation marks, and to a 7-year-old differently', () => {
    for (const [name, catalog] of Object.entries(CATALOGS)) {
      const big = Object.entries(catalog).filter(([key]) => key.startsWith('kid.big.'));
      expect(big.length, name).toBeGreaterThan(0);
      for (const [key, value] of big) expect(value, `${name} ${key}`).not.toContain('!');
      for (const [key, value] of big) {
        const little = catalog[key.replace('kid.big.', 'kid.little.')];
        expect(little, `${name} ${key}`).toBeDefined();
        expect(little, `${name} ${key}`).not.toBe(value);
      }
    }
  });

  it('keeps every plural whole: a `one` always has an `other` beside it', () => {
    const plurals = Object.keys(CATALOGS.en).filter((k) => k.endsWith('.one'));
    expect(plurals.length).toBeGreaterThan(0);
    for (const catalog of Object.values(CATALOGS)) {
      for (const key of Object.keys(catalog).filter((k) => k.endsWith('.one'))) {
        expect(catalog, key).toHaveProperty(key.replace(/\.one$/, '.other'));
      }
    }
  });
});
