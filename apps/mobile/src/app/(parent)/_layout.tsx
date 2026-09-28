import { useAuth } from '@clerk/expo';
import { Redirect, Stack, usePathname } from 'expo-router';
import { Button, ErrorText, Loading, Screen, Title } from '@/components/ui';
import { t } from '@/lib/i18n';
import { HouseholdProvider, useHousehold } from '@/lib/household-context';
import { INSTANT_SCREENS, parentScreens } from '@/lib/navigation';
import { HasHeaderProvider } from '@/lib/page-chrome';
import { useNotificationTapRouting } from '@/lib/notifications';
import { ThemeProvider, useTheme } from '@/theme';

/** Signed in → needs a household → create-household; has one → the children list. */
function HouseholdGate() {
  const state = useHousehold();
  const pathname = usePathname();
  // A tapped notification lands here rather than at the root, where `/`'s redirect to the role's
  // home would carry it straight back off its destination.
  useNotificationTapRouting('parent');
  if (state.status === 'loading') return <Loading />;
  if (state.status === 'error') {
    return (
      <Screen>
        <Title>{t('parent.unreachable')}</Title>
        <ErrorText>{state.message}</ErrorText>
        <Button title={t('common.tryAgain')} onPress={() => void state.refresh()} />
      </Screen>
    );
  }
  const onCreate = pathname === '/create-household';
  if (state.status === 'ready' && state.me.household === null && !onCreate) {
    return <Redirect href="/(parent)/create-household" />;
  }
  if (state.status === 'ready' && state.me.household !== null && onCreate) {
    return <Redirect href="/(parent)/(tabs)/(today)" />;
  }
  return <ParentStack />;
}

/**
 * Everything above the tabs. The tab bar is one screen of this stack, so the paywall, the
 * household form and anything else pushed from here covers the bar rather than sitting inside a
 * tab — which is what a paywall should do, and what keeps `create-household` from being escapable
 * by tapping another tab before the household exists.
 *
 * `(tabs)` draws no header of its own; each tab's stack draws its own.
 */
function ParentStack() {
  return (
    <HasHeaderProvider>
      <Stack screenOptions={parentScreens(useTheme())}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      </Stack>
    </HasHeaderProvider>
  );
}

/** The parent's theme covers the whole group, sign-in and the loading state included. */
export default function ParentLayout() {
  return (
    <ThemeProvider role="parent">
      <SignInGate />
    </ThemeProvider>
  );
}

function SignInGate() {
  const { isLoaded, isSignedIn } = useAuth();
  const pathname = usePathname();
  if (!isLoaded) return <Loading />;
  if (!isSignedIn) {
    return pathname === '/sign-in' ? (
      <Stack screenOptions={INSTANT_SCREENS} />
    ) : (
      <Redirect href="/(parent)/sign-in" />
    );
  }
  if (pathname === '/sign-in') return <Redirect href="/(parent)/(tabs)/(today)" />;
  return (
    <HouseholdProvider>
      <HouseholdGate />
    </HouseholdProvider>
  );
}
