import type { ChildDevice } from '@chores/shared';
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { useHousehold } from '@/lib/household-context';

type ChildDevicesState =
  | { status: 'loading'; devices: [] }
  | { status: 'error'; devices: []; message: string }
  | { status: 'ready'; devices: ChildDevice[] };

/**
 * One child's Kid Devices, revoked ones included — a revoked device is shown as revoked, so
 * hiding it here would hide the answer to "did that tablet stop syncing?". Plain REST: the
 * parent side has no local database and no outbox (#37).
 */
export function useChildDevices(
  childId: string | undefined,
): ChildDevicesState & { refresh: () => Promise<void> } {
  const { api, me } = useHousehold();
  const householdId = me?.household?.id ?? null;
  const [state, setState] = useState<ChildDevicesState>({ status: 'loading', devices: [] });

  const reload = useCallback(async () => {
    if (!householdId || !childId) return;
    try {
      setState({ status: 'ready', devices: await api.listChildDevices(householdId, childId) });
    } catch (e) {
      setState({
        status: 'error',
        devices: [],
        message: e instanceof Error ? e.message : 'failed',
      });
    }
  }, [api, householdId, childId]);

  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );

  return { ...state, refresh: reload };
}
