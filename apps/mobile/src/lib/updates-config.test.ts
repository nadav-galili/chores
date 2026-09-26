import { describe, expect, it } from 'vitest';
import { appJson, easJson, packageJson, profileNames } from '@/test/config';

/**
 * The OTA contract, which is spread over `app.json` and `eas.json` and fails silently when either
 * half drifts.
 *
 * `app.json` says where the app looks for updates and which runtime it will accept them for;
 * `eas.json` says which channel each build subscribes to. A build whose channel nobody set, or a
 * runtime version that moves for a reason the native binary does not share, does not fail a build
 * or a launch — it just never gets the update, or gets one its native side cannot run. That is
 * found by a child on a device, weeks later, which is why it is asserted here.
 *
 * `runtimeVersion` lives in `app.json` and not in the native projects because `apps/mobile/android`
 * and `apps/mobile/ios` are generated and gitignored (continuous native generation). In a project
 * that committed them, the policy in the app config would be inert and the value would have to be
 * written into the native files by hand.
 */

/**
 * Every build profile, and the channel a build from it subscribes to. A profile absent from this
 * map fails the test below rather than quietly shipping a binary that no `eas update` can reach.
 *
 * Two are deliberately `undefined`, and for different reasons. `development` builds a development
 * client, which loads its bundle from the dev server or from whatever it was launched with, so a
 * channel on it would describe a lookup that never happens. `preview-local` sets none of its own
 * because it extends `preview` and inherits that one — the assertion below reads the inherited
 * value, so this map holds what the file says, not what a build ends up with.
 */
const OWN_CHANNEL: Record<string, string | undefined> = {
  development: undefined,
  preview: 'preview',
  production: 'production',
  'preview-local': undefined,
};

describe('app.json updates configuration', () => {
  it('enables updates', () => {
    expect(appJson.expo.updates?.enabled).toBe(true);
  });

  it('points at this project on EAS Update, and not at another project', () => {
    const projectId = appJson.expo.extra?.eas?.projectId;
    expect(projectId).toBeDefined();
    expect(appJson.expo.updates?.url).toBe(`https://u.expo.dev/${projectId}`);
  });

  it('ties the runtime version to the app version', () => {
    expect(appJson.expo.runtimeVersion).toEqual({ policy: 'appVersion' });
  });

  /**
   * `appVersionSource: "remote"` means EAS, not `app.json`, holds the version a build is stamped
   * with — so under the `appVersion` policy the runtime version a build and an update agree on is
   * the remote one too. That combination is supported; the `nativeVersion` policy is the one remote
   * versioning does not support, which is what the assertion above rules out by naming the policy
   * exactly. The trap left over is a local `version` bump that looks like it moved the runtime and
   * did not.
   */
  it('is read against remote versioning, which is what makes the policy meaningful', () => {
    expect(easJson.cli?.appVersionSource).toBe('remote');
  });
});

describe('eas.json update channels', () => {
  it('decides a channel for every build profile', () => {
    expect(new Set(profileNames)).toEqual(new Set(Object.keys(OWN_CHANNEL)));
  });

  it.each(profileNames)('profile "%s" subscribes to the channel it is meant to', (name) => {
    expect(
      easJson.build[name]?.channel,
      `profile "${name}" must set the channel named in OWN_CHANNEL in this file, because a build's ` +
        `channel is embedded in the binary and cannot be changed afterwards`,
    ).toBe(OWN_CHANNEL[name]);
  });

  it('gives the store build a channel of its own, so no preview update can reach it', () => {
    expect(easJson.build.production?.channel).toBeDefined();
    expect(easJson.build.production?.channel).not.toBe(easJson.build.preview?.channel);
  });

  /** `preview-local` declares no channel of its own; a build from it must still land on one. */
  it('lets a local preview build inherit the preview channel', () => {
    expect(easJson.build['preview-local']?.extends).toBe('preview');
    expect(easJson.build.preview?.channel).toBe('preview');
  });
});

describe('expo-updates', () => {
  it('is a dependency, since the configuration above does nothing without it', () => {
    expect(packageJson.dependencies['expo-updates']).toBeDefined();
  });
});
