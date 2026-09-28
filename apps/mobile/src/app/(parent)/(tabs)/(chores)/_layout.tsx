import { Stack } from 'expo-router';
import { parentScreens } from '@/lib/navigation';
import { HasHeaderProvider } from '@/lib/page-chrome';
import { useTheme } from '@/theme';

/**
 * The list is the tab's first screen. The stack has no `index` of its own — its screens sit
 * one folder down — and without this expo-router's default is not the list but the form,
 * which opened the tab on "Add" with no way back (pre-submission QA).
 */
export const unstable_settings = { initialRouteName: 'chores/index' };

/**
 * One stack per tab, so each tab remembers where it was. A parent who walks into a child's week,
 * switches to Chores and comes back expects the week, not the list they started from.
 */
export default function ChoresTabLayout() {
  return (
    <HasHeaderProvider>
      <Stack screenOptions={parentScreens(useTheme())} />
    </HasHeaderProvider>
  );
}
