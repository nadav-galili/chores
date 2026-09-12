import type { ConfigContext, ExpoConfig } from 'expo/config';

/**
 * `app.json` is the whole of the app's configuration. This file exists for one thing the JSON
 * cannot do: read the environment.
 *
 * Source-map upload needs a Sentry org and project slug, and those belong to an account, not to
 * the repo — so they arrive as EAS environment variables (`SENTRY_ORG`, `SENTRY_PROJECT`, plus
 * `SENTRY_AUTH_TOKEN`, which the plugin reads itself). The config plugin is added here rather than
 * in `app.json` so there is one place that decides it, and it is added unconditionally, because it
 * is also what links the native SDK into the Android and iOS builds.
 *
 * Passing no org and project does not, however, make the upload sit out. The plugin writes a
 * `sentry.properties` of nothing but comments, and the Gradle task that reads it is gated on the
 * `SENTRY_DISABLE_AUTO_UPLOAD` environment variable alone — not on what is passed here. So a build
 * with no Sentry variables that does not also set that variable reaches `sentry-cli` with no
 * credentials and fails. `SENTRY_AUTH_TOKEN` is an EAS *secret*, readable only on an EAS builder,
 * which makes every `--local` build one of those: use the `preview-local` profile, which sets it.
 */
export default ({ config }: ConfigContext): ExpoConfig => {
  const organization = process.env.SENTRY_ORG;
  const project = process.env.SENTRY_PROJECT;
  return {
    // `ConfigContext` types every field as optional; `app.json` supplies them all, and restating
    // defaults here would be a second source of truth that can drift from it.
    ...(config as ExpoConfig),
    plugins: [
      ...(config.plugins ?? []),
      ['@sentry/react-native', organization && project ? { organization, project } : {}],
    ],
  };
};
