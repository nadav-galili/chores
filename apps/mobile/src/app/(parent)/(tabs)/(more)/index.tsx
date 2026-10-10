import { useAuth } from '@clerk/expo';
import { Stack, useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { NavList, Screen } from '@/components/ui';
import { useHousehold } from '@/lib/household-context';
import { t } from '@/lib/i18n';
import { canAskForPush } from '@/lib/notifications';

/**
 * What a parent sets once, and the way out.
 *
 * This is where the today screen's menu went. The four destinations a parent returns to are tabs
 * now; what is left here is configuration — the shop's catalogue, the second parent, the PIN that
 * guards kid mode — plus signing out and deleting the account, which are grouped apart and drawn
 * in `danger` so neither can be reached for by accident on the way to something else.
 *
 * Evening summary is the parent's other way to the push explanation (spec #86, Parent push), for
 * a parent who said "Not now" after "connected", a Partner, or a parent whose child joined from
 * the Children tab. It is there only while the OS would still show its prompt, re-read on every
 * focus, so it goes once it has been answered.
 */
export default function More() {
  const router = useRouter();
  const { signOut } = useAuth();
  const state = useHousehold();
  const [askable, setAskable] = useState(false);
  useFocusEffect(
    useCallback(() => {
      let live = true;
      canAskForPush()
        .then((can) => {
          if (live) setAskable(can);
        })
        // Reading the permission is nothing the parent can act on; the row stays hidden.
        .catch((e: unknown) => console.error('push permission read failed', e));
      return () => {
        live = false;
      };
    }, []),
  );
  // The explanation names the child when there is only one, as it does after "connected".
  const onlyChild =
    state.status === 'ready' && state.me.children.length === 1 ? state.me.children[0] : undefined;
  const eveningSummary = {
    title: t('parent.nav.eveningSummary'),
    onPress: () =>
      router.push({
        pathname: '/setup/push',
        params: onlyChild ? { from: 'more', id: onlyChild.id } : { from: 'more' },
      }),
  };
  return (
    <Screen list>
      <Stack.Screen options={{ title: t('parent.tabs.more') }} />
      <NavList
        groups={[
          [
            { title: t('parent.nav.rewards'), onPress: () => router.push('/rewards') },
            { title: t('parent.nav.partner'), onPress: () => router.push('/partner') },
            { title: t('parent.nav.pin'), onPress: () => router.push('/pin') },
            ...(askable ? [eveningSummary] : []),
            { title: t('language.title'), onPress: () => router.push('/language') },
          ],
          [
            { title: t('parent.nav.signOut'), onPress: () => void signOut(), destructive: true },
            {
              title: t('parent.nav.deleteAccount'),
              onPress: () => router.push('/delete-account'),
              destructive: true,
            },
          ],
        ]}
      />
    </Screen>
  );
}
