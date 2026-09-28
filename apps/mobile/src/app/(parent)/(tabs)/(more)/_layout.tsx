import { Stack } from 'expo-router';
import { parentScreens } from '@/lib/navigation';
import { HasHeaderProvider } from '@/lib/page-chrome';
import { useTheme } from '@/theme';

/**
 * One stack per tab, so each tab remembers where it was. A parent who walks into a child's week,
 * switches to Chores and comes back expects the week, not the list they started from.
 */
export default function MoreTabLayout() {
  return (
    <HasHeaderProvider>
      <Stack screenOptions={parentScreens(useTheme())} />
    </HasHeaderProvider>
  );
}
