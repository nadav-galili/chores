// First import in the app: `uuid7()` needs `crypto.getRandomValues`, which Hermes does not have,
// and every write depends on it.
import '@/lib/crypto';
import { ClerkProvider } from '@clerk/expo';
import * as Sentry from '@sentry/react-native';
import { tokenCache } from '@clerk/expo/token-cache';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useEffect, useState } from 'react';
import { startErrorReporting } from '@/lib/error-reporting';
import { forgetPreviousInstall } from '@/lib/install';
import { INSTANT_SCREENS } from '@/lib/navigation';
import { watchOpenedNotifications } from '@/lib/notifications';
import { useDisplayFont } from '@/theme';

// At module load, before any screen mounts and before the line below can throw: a crash during
// startup is the one nobody can report from inside a component (#35). A no-op in development and
// without a DSN.
startErrorReporting();

const publishableKey = requireEnv(process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY);

function RootLayout() {
  // Registers Rubik so the type scale can name it. Nothing renders it yet, and
  // text before it lands falls back to the system font, so this never blocks.
  useDisplayFont();
  // One listener for the whole app: a notification is tapped from wherever the app was, or from
  // nowhere at all on a cold start (docs/spec/01-product.md, digest open rate).
  useEffect(watchOpenedNotifications, []);
  // Nothing mounts until a reinstall has been noticed: the role picker and the kid gate both read
  // the secure store on mount, and would find the previous install's kid session still there.
  const [fresh, setFresh] = useState(false);
  useEffect(() => {
    // Whatever happens in there, the app opens: a store that cannot be read is logged inside, and
    // anything else is logged here rather than leaving a blank screen for good.
    forgetPreviousInstall()
      .catch((e: unknown) => console.error('reinstall check failed', e))
      .finally(() => setFresh(true));
  }, []);
  if (!fresh) return null;
  return (
    // The provider has to sit above every group, because `Screen` reads the insets and `Screen` is
    // what both roles' pages are made of. Without it `useSafeAreaInsets()` reports zeros and the
    // padding below a notch is the theme's 24 rather than the phone's 59.
    <SafeAreaProvider>
      <ClerkProvider publishableKey={publishableKey} tokenCache={tokenCache}>
        <StatusBar style="auto" />
        <Stack screenOptions={INSTANT_SCREENS} />
      </ClerkProvider>
    </SafeAreaProvider>
  );
}

// `Sentry.wrap` is what catches an unhandled render error rather than letting the app die silently.
export default Sentry.wrap(RootLayout);

function requireEnv(value: string | undefined): string {
  if (!value) throw new Error('EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY is required');
  return value;
}
