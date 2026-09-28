import { useAuth } from '@clerk/expo';
import { Stack, useRouter } from 'expo-router';
import { NavList, Screen } from '@/components/ui';
import { t } from '@/lib/i18n';

/**
 * What a parent sets once, and the way out.
 *
 * This is where the today screen's menu went. The four destinations a parent returns to are tabs
 * now; what is left here is configuration — the shop's catalogue, the second parent, the PIN that
 * guards kid mode — plus signing out, which is grouped apart and drawn in `danger` so it cannot
 * be reached for by accident on the way to something else.
 */
export default function More() {
  const router = useRouter();
  const { signOut } = useAuth();
  return (
    <Screen list>
      <Stack.Screen options={{ title: t('parent.tabs.more') }} />
      <NavList
        groups={[
          [
            { title: t('parent.nav.rewards'), onPress: () => router.push('/rewards') },
            { title: t('parent.nav.partner'), onPress: () => router.push('/partner') },
            { title: t('parent.nav.pin'), onPress: () => router.push('/pin') },
            { title: t('language.title'), onPress: () => router.push('/language') },
          ],
          [{ title: t('parent.nav.signOut'), onPress: () => void signOut(), destructive: true }],
        ]}
      />
    </Screen>
  );
}
