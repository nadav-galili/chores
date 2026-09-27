import { describe, expect, it } from 'vitest';
import { easJson, profileNames, resolveEnv } from '@/test/config';

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

describe('eas.json build profiles', () => {
  const names = profileNames;

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
 * The apex of the domain we own, since #84. Spelled out rather than read from `eas.json` — a test
 * that reads the value it is checking passes whatever is there, including the Railway-generated
 * hostname this replaced, which App Review reads on the store listing.
 */
const PRODUCTION_API_URL = 'https://mibokids.app';

/**
 * The store build is the one nobody gets to re-run cheaply: a wrong API URL or a missing analytics
 * key is found by the reviewer, not by us. So its environment is asserted here rather than trusted.
 *
 * The Clerk key is checked for shape, and for `pk_live_` specifically. #78 left it as
 * `pk_(test|live)_` because Mibo's Clerk application had no production instance; #84 created one on
 * `mibokids.app` and `d77072e` put its key in both store-bound profiles, so the narrower assertion
 * is now the one that holds. It matters more than it looks: a `pk_test_` key in a store build is a
 * working app pointed at a development Clerk instance, with that instance's users, its rate limits
 * and its shared OAuth credentials — nothing fails, and every parent who signs up signs up in the
 * wrong place.
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
    expect(resolveEnv('production').EXPO_PUBLIC_API_URL).toBe(PRODUCTION_API_URL);
  });

  it('carries a Clerk publishable key and a PostHog key', () => {
    const env = resolveEnv('production');
    expect(env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY).toMatch(/^pk_live_/);
    expect(env.EXPO_PUBLIC_POSTHOG_KEY).toMatch(/^phc_/);
  });
});

/**
 * The submit profile, which is how the built `.ipa` reaches App Store Connect (#83). #78 deferred it
 * deliberately: a build profile and a submit profile are separate sections of `eas.json` and only
 * the second one is read by `eas submit`.
 *
 * The profile has to exist under the name the build profile has, because `eas submit --profile
 * production` resolves against `submit`, not `build` — with no such profile the command stops and
 * asks, which is the one thing a release script cannot answer on somebody's behalf.
 *
 * `ascAppId` is the App Store Connect app id, and it is *not* in this file: it is an account-level
 * identifier that only the account holder can read off the app record, so `scripts/release-ios.sh`
 * writes it here on its first run. So the assertion below is conditional on purpose — it holds the
 * shape rather than the presence. A fresh checkout has an empty `ios` block and passes; a checkout
 * where somebody pasted the bundle id, the Apple ID email or a number with a stray character into
 * the field fails, which is the mistake that actually happens. An empty block means `eas submit`
 * finds the app by bundle id instead, one extra round trip and one extra prompt.
 */
describe('the submit profile', () => {
  it('exists under the name the build profile uses', () => {
    expect(
      easJson.submit?.production,
      `eas.json needs a submit profile named "production", because "eas submit --profile production" ` +
        `resolves against the "submit" section and not the "build" one`,
    ).toBeDefined();
  });

  it('names an App Store Connect app id, or none at all', () => {
    const ascAppId = easJson.submit?.production?.ios?.ascAppId;
    if (ascAppId === undefined) return;
    expect(
      ascAppId,
      `ascAppId is App Store Connect's own numeric app id — not the bundle id, not an Apple ID`,
    ).toMatch(/^[0-9]+$/);
  });

  it('names an Apple team id, or none at all', () => {
    const appleTeamId = easJson.submit?.production?.ios?.appleTeamId;
    if (appleTeamId === undefined) return;
    expect(appleTeamId).toMatch(/^[A-Z0-9]{10}$/);
  });
});

/**
 * `preview` is the profile a device runs when a human checks something that only exists off the
 * repo — the three links on Google's OAuth consent screen (#84) among them. A preview build calling
 * a different API from the store build is a check that proved nothing, and until now nothing said
 * which API it calls.
 */
describe('the preview profile', () => {
  it('calls the same API as the store build', () => {
    expect(resolveEnv('preview').EXPO_PUBLIC_API_URL).toBe(PRODUCTION_API_URL);
  });
});
