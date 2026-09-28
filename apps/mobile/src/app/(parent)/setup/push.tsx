import { pushPromptAnswered } from '@chores/shared';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Body, Button, Screen, Title } from '@/components/ui';
import { captureParentEvent } from '@/lib/analytics';
import { useHousehold } from '@/lib/household-context';
import { t } from '@/lib/i18n';
import { askForParentPush } from '@/lib/notifications';
import { TODAY } from '@/lib/setup';

/**
 * The parent-push explanation, between "connected" and Today (spec #86, Parent push): the parent
 * has just seen Mibo work, and is told the one thing notifications are for — the Digest. Only
 * "Allow" raises the OS prompt; "Not now" goes to Today and tells no one, the server included.
 * Reached only while the OS would still show its prompt, so "Allow" never leads nowhere.
 */
export default function SetupPush() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const state = useHousehold();
  const router = useRouter();
  const [asking, setAsking] = useState(false);

  const householdId = state.status === 'ready' ? state.me.household?.id : undefined;
  const { api } = state;
  const allow = useCallback(async () => {
    setAsking(true);
    try {
      if (householdId) {
        const granted = await askForParentPush((input) => api.registerDevice(householdId, input));
        captureParentEvent(pushPromptAnswered({ role: 'parent', granted }));
      }
    } catch (e) {
      // A refused prompt or a registration that failed is nothing the parent can act on here;
      // the next open's registration retries it. Only the error goes to the console.
      console.error('parent push request failed', e);
    }
    router.dismissTo(TODAY);
  }, [api, householdId, router]);

  const child = state.status === 'ready' ? state.me.children.find((c) => c.id === id) : undefined;
  if (!child) return null;

  return (
    <Screen>
      <Stack.Screen options={{ title: '', headerBackVisible: false, gestureEnabled: false }} />
      <Title>{t('setup.push.title', { name: child.first_name })}</Title>
      <Body>{t('setup.push.body')}</Body>
      <Button title={t('setup.push.allow')} onPress={() => void allow()} disabled={asking} />
      <Button
        title={t('setup.push.notNow')}
        secondary
        disabled={asking}
        onPress={() => router.dismissTo(TODAY)}
      />
    </Screen>
  );
}
