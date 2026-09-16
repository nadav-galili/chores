import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The Sentry config plugin is added unconditionally (see `app.config.ts`), and passing it no org
 * and project does not make the source-map upload sit out — it writes a `sentry.properties` of
 * nothing but comments, and the build task that reads it is gated on `SENTRY_DISABLE_AUTO_UPLOAD`
 * alone. So a profile with neither the credentials nor that variable reaches `sentry-cli` with
 * nothing and fails — twenty minutes into a build, which is the whole reason this is a test and
 * not a lesson. (#75)
 *
 * A profile that genuinely uploads gets its credentials from EAS environment variables, which are
 * not in this file and cannot be read from here. Those profiles are named below, one line each, so
 * that a new profile fails this test until somebody decides which kind it is.
 */
const UPLOADS_SOURCE_MAPS = new Set([
  'preview', // SENTRY_ORG / SENTRY_PROJECT / SENTRY_AUTH_TOKEN come from the EAS builder.
]);

type Profile = { extends?: string; env?: Record<string, string> };

const easJson = JSON.parse(
  readFileSync(path.resolve(import.meta.dirname, '../../eas.json'), 'utf8'),
) as { build: Record<string, Profile> };

/** Follows `extends` the way EAS does: the nearest definition of a variable wins. */
function resolveEnv(name: string): Record<string, string> {
  const chain: Profile[] = [];
  for (let current: string | undefined = name; current;) {
    const profile: Profile | undefined = easJson.build[current];
    if (!profile)
      throw new Error(`eas.json profile "${name}" extends unknown profile "${current}"`);
    chain.unshift(profile);
    current = profile.extends;
  }
  return Object.assign({}, ...chain.map((profile) => profile.env ?? {}));
}

describe('eas.json build profiles', () => {
  const names = Object.keys(easJson.build);

  it('has profiles to check', () => {
    expect(names.length).toBeGreaterThan(0);
  });

  it.each(names)('profile "%s" says whether it uploads source maps', (name) => {
    if (UPLOADS_SOURCE_MAPS.has(name)) {
      expect(resolveEnv(name).SENTRY_DISABLE_AUTO_UPLOAD).toBeUndefined();
      return;
    }
    expect(
      resolveEnv(name).SENTRY_DISABLE_AUTO_UPLOAD,
      `profile "${name}" sets no Sentry credentials, so it must set SENTRY_DISABLE_AUTO_UPLOAD="true" ` +
        `or be added to UPLOADS_SOURCE_MAPS in this file`,
    ).toBe('true');
  });

  it('names no profile that no longer exists', () => {
    for (const name of UPLOADS_SOURCE_MAPS) expect(names).toContain(name);
  });
});
