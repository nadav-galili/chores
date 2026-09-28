import { onboardingStepViewed } from '@chores/shared';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef } from 'react';
import { Body, Button, Screen, Title } from '@/components/ui';
import { captureParentEvent } from '@/lib/analytics';
import { stopAwaitingDevice } from '@/lib/connected';
import { useHousehold } from '@/lib/household-context';
import { t } from '@/lib/i18n';
import { TODAY } from '@/lib/setup';

/**
 * "{name}'s device is connected": the end of guided setup, for the child in `?id=` (spec #86).
 * Reached two ways — the Join Code step switching over by itself when the device joins, or the gate
 * on the parent's next open when they had left before it did. Either way it is shown once: this
 * phone's "last seen" record is cleared here, so the next open confirms nothing.
 */
export default function SetupConnected() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const state = useHousehold();
  const router = useRouter();
  // Once per mount, not once per `refresh` identity: that is rebuilt whenever Clerk hands back a
  // new token getter, and each rebuild would count another view.
  const refresh = useRef(state.refresh);
  useEffect(() => {
    stopAwaitingDevice();
    captureParentEvent(onboardingStepViewed({ step: 'connected' }));
    // Re-read `/me` now, so Today's Finish setup card is already gone when the parent gets there.
    void refresh.current();
  }, []);

  // Where setup goes after "connected". The parent-push explanation (#92) belongs between this
  // screen and Today: route there from here rather than straight to the tabs.
  const next = useCallback(() => router.dismissTo(TODAY), [router]);

  const child = state.status === 'ready' ? state.me.children.find((c) => c.id === id) : undefined;
  if (!child) return null;

  return (
    <Screen>
      <Stack.Screen options={{ title: '', headerBackVisible: false, gestureEnabled: false }} />
      <Title>{t('setup.connected.title', { name: child.first_name })}</Title>
      <Body>{t('setup.connected.body', { name: child.first_name })}</Body>
      <Button title={t('common.continue')} onPress={next} />
    </Screen>
  );
}
