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
 *
 * What this file *can* check is that such a profile says which EAS environment it reads, because EAS
 * infers that from the profile's shape and not its name — `distribution: "store"` reads
 * `production`, `developmentClient` reads `development`, everything else reads `preview`. A profile
 * named `production` that forgot to say so would have silently read a different environment's
 * variables than `scripts/setup-sentry.sh` wrote.
 */
const UPLOADS_SOURCE_MAPS = new Set([
  'preview', // SENTRY_ORG / SENTRY_PROJECT / SENTRY_AUTH_TOKEN come from the EAS builder.
  'production', // Same, and a store build is the one whose stack traces have to be readable.
]);

type Profile = {
  extends?: string;
  distribution?: string;
  environment?: string;
  env?: Record<string, string>;
};

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

  it.each([...UPLOADS_SOURCE_MAPS])(
    'uploading profile "%s" names the EAS environment its credentials live in',
    (name) => {
      expect(
        easJson.build[name]?.environment,
        `profile "${name}" uploads source maps, so it must set "environment" rather than let EAS ` +
          `infer one — the inferred environment is the one nobody remembered to populate`,
      ).toBeDefined();
    },
  );
});

/**
 * The store build is the one nobody gets to re-run cheaply: a wrong API URL or a missing analytics
 * key is found by the reviewer, not by us. So its environment is asserted here rather than trusted.
 *
 * The Clerk key is only checked for shape. Mibo's Clerk application has no production instance yet
 * (`clerk whoami` reports `"production": null`), so the store profile carries the same `pk_test_`
 * key as `preview`; swapping in the `pk_live_` one is part of the production release ticket (#83),
 * and narrowing this to `/^pk_live_/` is how that swap gets enforced once it exists.
 */
describe('the production profile', () => {
  const profile = easJson.build.production;

  it('exists', () => {
    expect(profile).toBeDefined();
  });

  it('builds for App Store distribution', () => {
    expect(profile?.distribution).toBe('store');
  });

  it('points at the production API', () => {
    expect(resolveEnv('production').EXPO_PUBLIC_API_URL).toBe(
      'https://api-production-c5c7.up.railway.app',
    );
  });

  it('carries a Clerk publishable key and a PostHog key', () => {
    const env = resolveEnv('production');
    expect(env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY).toMatch(/^pk_(test|live)_/);
    expect(env.EXPO_PUBLIC_POSTHOG_KEY).toMatch(/^phc_/);
  });
});
