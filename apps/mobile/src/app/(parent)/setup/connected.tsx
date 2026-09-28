import { onboardingStepViewed } from '@chores/shared';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef } from 'react';
import { Body, Button, Screen, Title } from '@/components/ui';
import { captureParentEvent } from '@/lib/analytics';
import { clearAwaitingDeviceRecord } from '@/lib/connected';
import { useHousehold, useHouseholdChild } from '@/lib/household-context';
import { t } from '@/lib/i18n';
import { canAskForPush } from '@/lib/notifications';
import { TODAY_HREF } from '@/lib/setup';

/**
 * "{name}'s device is connected": the end of guided setup, for the child in `?id=` (spec #86).
 * Reached two ways — the Join Code step switching over by itself when the device joins, or the gate
 * on the parent's next open when they had left before it did. Either way it is shown once: this
 * phone's "last seen" record is cleared here, so the next open confirms nothing.
 */
export default function SetupConnected() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const state = useHousehold();
  const child = useHouseholdChild(id);
  const router = useRouter();
  // Once per mount, not once per `refresh` identity: that is rebuilt whenever Clerk hands back a
  // new token getter, and each rebuild would count another view.
  const refresh = useRef(state.refresh);
  useEffect(() => {
    clearAwaitingDeviceRecord();
    captureParentEvent(onboardingStepViewed({ step: 'connected' }));
    // Re-read `/me` now, so Today's Finish setup card is already gone when the parent gets there.
    void refresh.current();
  }, []);

  // Where setup goes after "connected": the parent-push explanation while the OS would still show
  // its prompt, otherwise — already allowed, or refused for good — straight on to Today.
  const next = useCallback(async () => {
    let askable = false;
    try {
      askable = await canAskForPush();
    } catch (e) {
      // Reading the permission is not something the parent can act on; setup simply ends.
      console.error('push permission read failed', e);
    }
    if (askable) router.replace({ pathname: '/setup/push', params: { id } });
    else router.dismissTo(TODAY_HREF);
  }, [id, router]);

  if (!child) return null;

  return (
    <Screen>
      <Stack.Screen options={{ title: '', headerBackVisible: false, gestureEnabled: false }} />
      <Title>{t('setup.connected.title', { name: child.first_name })}</Title>
      <Body>{t('setup.connected.body', { name: child.first_name })}</Body>
      <Button title={t('common.continue')} onPress={() => void next()} />
    </Screen>
  );
}
