import type { Reward } from '@chores/shared';
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { useHousehold } from '@/lib/household-context';

type RewardsState =
  | { status: 'loading'; rewards: [] }
  | { status: 'error'; rewards: []; message: string }
  | { status: 'ready'; rewards: Reward[] };

/** The household's own catalog — hidden rows included, since hiding is what this screen edits. */
export function useRewards(): RewardsState & { refresh: () => Promise<void> } {
  const { api, me } = useHousehold();
  const householdId = me?.household?.id ?? null;
  const [state, setState] = useState<RewardsState>({ status: 'loading', rewards: [] });

  const reload = useCallback(async () => {
    if (!householdId) return;
    try {
      setState({ status: 'ready', rewards: await api.listRewards(householdId) });
    } catch (e) {
      setState({
        status: 'error',
        rewards: [],
        message: e instanceof Error ? e.message : 'failed',
      });
    }
  }, [api, householdId]);

  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );

  return { ...state, refresh: reload };
}
