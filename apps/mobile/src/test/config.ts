import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * The three config files whose contents are asserted by tests, read once and typed once.
 *
 * `app.json`, `eas.json` and `package.json` decide things no amount of application code can
 * recover from — which Sentry credentials a build reaches for, which channel it subscribes to,
 * which runtime an update may land on. Each is a build-time fact, so the tests that hold them to
 * a contract read the file rather than the app. This module exists so that the shape of those
 * files is declared in one place: a new build profile is then one edit, not one per test file.
 *
 * Nothing in `src/app`, `src/sync` or `src/lib` imports this — it never reaches a bundle.
 */
const mobileRoot = path.resolve(import.meta.dirname, '../..');

function readJson<T>(file: string): T {
  return JSON.parse(readFileSync(path.join(mobileRoot, file), 'utf8')) as T;
}

export type AppJson = {
  expo: {
    version?: string;
    updates?: { url?: string; enabled?: boolean };
    runtimeVersion?: string | { policy?: string };
    extra?: { eas?: { projectId?: string } };
  };
};

export type BuildProfile = {
  extends?: string;
  distribution?: string;
  environment?: string;
  channel?: string;
  env?: Record<string, string>;
};

export type EasJson = {
  cli?: { appVersionSource?: string };
  build: Record<string, BuildProfile>;
};

export const appJson = readJson<AppJson>('app.json');
export const easJson = readJson<EasJson>('eas.json');
export const packageJson = readJson<{ dependencies: Record<string, string> }>('package.json');

/** The build profiles, in the order `eas.json` declares them. */
export const profileNames = Object.keys(easJson.build);

/**
 * Resolves a profile's `env` the way EAS does: `extends` is followed outward, and the nearest
 * definition of a variable wins. `channel` and the rest are single values and are read directly,
 * so only `env` needs this.
 */
export function resolveEnv(name: string): Record<string, string> {
  const chain: BuildProfile[] = [];
  for (let current: string | undefined = name; current;) {
    const profile: BuildProfile | undefined = easJson.build[current];
    if (!profile)
      throw new Error(`eas.json profile "${name}" extends unknown profile "${current}"`);
    chain.unshift(profile);
    current = profile.extends;
  }
  return Object.assign({}, ...chain.map((profile) => profile.env ?? {}));
}
