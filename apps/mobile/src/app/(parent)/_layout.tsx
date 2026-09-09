import { useAuth } from '@clerk/expo';
import { Redirect, Stack, usePathname } from 'expo-router';
import { Button, ErrorText, Loading, Screen, Title } from '@/components/ui';
import { HouseholdProvider, useHousehold } from '@/lib/household-context';

/** Signed in → needs a household → create-household; has one → the children list. */
function HouseholdGate() {
  const state = useHousehold();
  const pathname = usePathname();
  if (state.status === 'loading') return <Loading />;
  if (state.status === 'error') {
    return (
      <Screen>
        <Title>Could not reach Mibo</Title>
        <ErrorText>{state.message}</ErrorText>
        <Button title="Try again" onPress={() => void state.refresh()} />
      </Screen>
    );
  }
  const onCreate = pathname === '/create-household';
  if (state.status === 'ready' && state.me.household === null && !onCreate) {
    return <Redirect href="/(parent)/create-household" />;
  }
  if (state.status === 'ready' && state.me.household !== null && onCreate) {
    return <Redirect href="/(parent)" />;
  }
  return <Stack screenOptions={{ headerShown: false }} />;
}

export default function ParentLayout() {
  const { isLoaded, isSignedIn } = useAuth();
  const pathname = usePathname();
  if (!isLoaded) return <Loading />;
  if (!isSignedIn) {
    return pathname === '/sign-in' ? (
      <Stack screenOptions={{ headerShown: false }} />
    ) : (
      <Redirect href="/(parent)/sign-in" />
    );
  }
  if (pathname === '/sign-in') return <Redirect href="/(parent)" />;
  return (
    <HouseholdProvider>
      <HouseholdGate />
    </HouseholdProvider>
  );
}
