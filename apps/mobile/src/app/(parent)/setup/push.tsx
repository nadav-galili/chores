import { pushPromptAnswered } from '@chores/shared';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Body, Button, Screen, Title } from '@/components/ui';
import { captureParentEvent } from '@/lib/analytics';
import { useHousehold, useHouseholdChild, useHouseholdId } from '@/lib/household-context';
import { t } from '@/lib/i18n';
import { HasHeaderProvider } from '@/lib/page-chrome';
import { askForParentPush } from '@/lib/notifications';
import { TODAY_HREF } from '@/lib/setup';

/**
 * The parent-push explanation (spec #86, Parent push): the parent is told the one thing
 * notifications are for — the Digest. Only "Allow" raises the OS prompt; "Not now" tells no one,
 * the server included. Reached only while the OS would still show its prompt, so "Allow" never
 * leads nowhere, and from two places:
 *
 * - between "connected" and Today, for the child in `?id=`: the parent has just seen Mibo work,
 *   and either answer ends setup on Today;
 * - from More's Evening summary row (`?from=more`), for a parent who said "Not now" here, a
 *   Partner, or a parent whose child joined from the Children tab: either answer goes back to More.
 */
export default function SetupPush() {
  const { id, from } = useLocalSearchParams<{ id?: string; from?: 'more' }>();
  const { api } = useHousehold();
  const householdId = useHouseholdId();
  const child = useHouseholdChild(id);
  const router = useRouter();
  const [asking, setAsking] = useState(false);

  const done = useCallback(() => {
    if (from === 'more') router.back();
    else router.dismissTo(TODAY_HREF);
  }, [from, router]);

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
    done();
  }, [api, householdId, done]);

  if (!householdId || (id && !child)) return null;

  return (
    // No header: there is nowhere back to go from here, and an empty bar was a bar with nothing to
    // say — a blank strip the screen reader announced by its native class name.
    <HasHeaderProvider hasHeader={false}>
      <Screen>
        <Stack.Screen options={{ headerShown: false, gestureEnabled: false }} />
        <Title>
          {child ? t('setup.push.title', { name: child.first_name }) : t('setup.push.titleHousehold')}
        </Title>
        <Body>{t('setup.push.body')}</Body>
        <Button title={t('setup.push.allow')} onPress={() => void allow()} disabled={asking} />
        <Button title={t('setup.push.notNow')} secondary disabled={asking} onPress={done} />
      </Screen>
    </HasHeaderProvider>
  );
}
