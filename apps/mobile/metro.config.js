// Sentry's wrapper around Expo's default Metro config. It stamps a debug id into the bundle and
// the source map, which is what lets an uploaded map be matched to a released build; everything
// else about the config is Expo's own.
const { getSentryExpoConfig } = require('@sentry/react-native/metro');

module.exports = getSentryExpoConfig(__dirname);
