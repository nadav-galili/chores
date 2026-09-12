import type { ParentWeek } from '@chores/shared';
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { useHousehold } from '@/lib/household-context';

type WeekState =
  | { status: 'loading'; week: ParentWeek | null }
  | { status: 'error'; week: ParentWeek | null; message: string }
  | { status: 'ready'; week: ParentWeek };

/**
 * One child's last seven Chore Dates, reloaded when the screen comes into focus and after a
 * rejection. No poll: history is not a live scan the way the today screen is, and a grid that
 * redrew every minute would move under a parent reading it.
 *
 * The last good payload is kept through a failure, so a dropped request leaves the grid on
 * screen with a line above it rather than blanking the page.
 */
export function useChildWeek(childId: string | null): WeekState & { refresh: () => Promise<void> } {
  const { api, me } = useHousehold();
  const householdId = me?.household?.id ?? null;
  const [state, setState] = useState<WeekState>({ status: 'loading', week: null });

  const reload = useCallback(async () => {
    if (!householdId || !childId) return;
    try {
      setState({ status: 'ready', week: await api.childWeek(householdId, childId) });
    } catch (e) {
      setState((held) => ({
        status: 'error',
        week: held.week,
        message: e instanceof Error ? e.message : 'failed',
      }));
    }
  }, [api, childId, householdId]);

  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );

  return { ...state, refresh: reload };
}
