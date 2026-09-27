const fs = require('node:fs');
const path = require('node:path');

const { withDangerousMod } = require('expo/config-plugins');

const ANCHOR = '  post_install do |installer|\n';
const MARKER = 'generate_available_uuid_list';

/**
 * CocoaPods rewrites every UUID in the Pods project (`predictabilize_uuids`) and then hands that
 * project to the Podfile's post-install hooks — with its own UUID generator restarted from zero and
 * no check for what is already taken (`Pod::Project#generate_available_uuid_list`). React Native's
 * `spm.rb` creates three objects in that hook, the Swift package reference `@clerk/expo` asks for
 * plus one product dependency each for ClerkKit and ClerkKitUI, so the three of them are handed the
 * UUIDs of the first three objects in the project. One of those is the root `PBXProject`, and it
 * loses: Xcode reads `rootObject`, finds an `XCRemoteSwiftPackageReference` there, and reports
 *
 *     -[XCRemoteSwiftPackageReference _setSavedArchiveVersion:]: unrecognized selector
 *     The project "Pods" is damaged and cannot be opened.
 *
 * It then drops Pods.xcodeproj from the workspace — a warning, not an error — and archives the app
 * target on its own ("Target dependency graph (1 target)"). No pod is built, so every pod modulemap
 * is missing and the build ends on `no such module 'Expo'`.
 *
 * Expo carries the same fix in `expo-modules-autolinking`, but installs it in
 * `perform_post_install_actions`, which CocoaPods runs after the Podfile's hooks — too late for
 * `spm.rb`. So install it here instead, at the top of the hook that needs it: Xcodeproj's own
 * generator, whose 24-character random UUIDs cannot collide with CocoaPods' 14-character sequential
 * ones or its 32-character deterministic ones, whatever order they are handed out in.
 */
const PATCH = `    require 'securerandom'
    installer.generated_projects.each do |project|
      project.define_singleton_method(:generate_available_uuid_list) do |count = 100|
        uniques = Array.new(count) { SecureRandom.hex(12).upcase } - @generated_uuids - uuids
        @generated_uuids += uniques
        @available_uuids += uniques
      end
    end

`;

module.exports = function withPodsProjectUuids(config) {
  return withDangerousMod(config, [
    'ios',
    (dangerousConfig) => {
      const podfile = path.join(dangerousConfig.modRequest.platformProjectRoot, 'Podfile');
      const contents = fs.readFileSync(podfile, 'utf8');

      if (contents.includes(MARKER)) {
        return dangerousConfig;
      }
      if (!contents.includes(ANCHOR)) {
        throw new Error(
          `with-pods-project-uuids: could not find ${JSON.stringify(ANCHOR.trim())} in ${podfile}. ` +
            'The Podfile template changed; re-check whether the UUID collision it works around is ' +
            'still there before deleting this plugin.'
        );
      }

      fs.writeFileSync(podfile, contents.replace(ANCHOR, ANCHOR + PATCH));
      return dangerousConfig;
    },
  ]);
};
