import type { Chore } from '@chores/shared';
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { useHousehold } from '@/lib/household-context';

type ChoresState =
  | { status: 'loading'; chores: [] }
  | { status: 'error'; chores: []; message: string }
  | { status: 'ready'; chores: Chore[] };

/** The household's live (non-deleted) chores, reloaded every time the screen gains focus. */
export function useChores(): ChoresState {
  const { api, me } = useHousehold();
  const householdId = me?.household?.id ?? null;
  const [state, setState] = useState<ChoresState>({ status: 'loading', chores: [] });

  const reload = useCallback(async () => {
    if (!householdId) return;
    try {
      setState({ status: 'ready', chores: await api.listChores(householdId) });
    } catch (e) {
      setState({ status: 'error', chores: [], message: e instanceof Error ? e.message : 'failed' });
    }
  }, [api, householdId]);

  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );

  return state;
}
