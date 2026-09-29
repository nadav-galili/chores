import { useAuth } from '@clerk/expo';
import { connectedOnOpen, setupStepOnSignIn } from '@chores/shared';
import { Redirect, Stack, usePathname } from 'expo-router';
import { useEffect, useState } from 'react';
import { Button, ErrorText, Loading, Screen, Title } from '@/components/ui';
import { readAwaitingDeviceRecord } from '@/lib/connected';
import { t } from '@/lib/i18n';
import { HouseholdProvider, useHousehold } from '@/lib/household-context';
import { INSTANT_SCREENS, parentScreens } from '@/lib/navigation';
import { HasHeaderProvider } from '@/lib/page-chrome';
import { useNotificationTapRouting } from '@/lib/notifications';
import { nextSetupHref, setupStepHref, TODAY_HREF } from '@/lib/setup';
import { useScreenViewed } from '@/lib/track';
import { ThemeProvider, useTheme } from '@/theme';

/**
 * Signed in → needs a household → create-household; has one → guided setup or Today.
 *
 * The parent who created the household is routed into the first unfinished setup step on the
 * first navigation after sign-in — once per mount of this gate, which is once per sign-in in an
 * app session, so a killed app resumes at the step it stopped on and "I'll finish later" is not
 * overruled by the next render. A Partner, and any household a Kid Device has joined, is never
 * routed; the Finish setup card on Today covers both.
 */
function HouseholdGate() {
  const state = useHousehold();
  const pathname = usePathname();
  const [entered, setEntered] = useState(false);
  // A tapped notification lands here rather than at the root, where `/`'s redirect to the role's
  // home would carry it straight back off its destination.
  useNotificationTapRouting('parent');
  const ready = state.status === 'ready';
  useEffect(() => {
    if (ready) setEntered(true);
  }, [ready]);
  if (state.status === 'loading') return <Loading />;
  if (state.status === 'error') {
    return (
      <Screen>
        <Title>{t('parent.unreachable')}</Title>
        <ErrorText>{state.message}</ErrorText>
        <Button name="try_again" title={t('common.tryAgain')} onPress={() => void state.refresh()} />
      </Screen>
    );
  }
  const { me } = state;
  const onCreate = pathname === '/create-household';
  if (me.household === null && !onCreate) {
    return <Redirect href="/(parent)/create-household" />;
  }
  if (me.household !== null && onCreate) {
    // The household was just created (or already existed): straight on to the next step.
    const next = me.setup.createdHousehold ? nextSetupHref(me) : null;
    return <Redirect href={next ?? TODAY_HREF} />;
  }
  if (!entered && !pathname.startsWith('/setup/')) {
    const step = setupStepOnSignIn(me.setup);
    const href = step ? setupStepHref(step, me) : null;
    if (href) return <Redirect href={href} />;
    // A parent who left the Join Code step before the device joined sees "connected" once, now.
    const connected = connectedOnOpen(readAwaitingDeviceRecord(), me);
    if (connected) {
      return <Redirect href={{ pathname: '/setup/connected', params: { id: connected } }} />;
    }
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
  useScreenViewed();
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
