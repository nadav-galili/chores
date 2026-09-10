import type { DeviceSession } from '@chores/shared';
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { openDeviceDb } from '@/db/client';
import { showGrove, type GroveView } from '@/sync/grove';

/**
 * The grove, read from the local database and nothing else.
 *
 * Deliberately not `useToday`: the grove screen has no list to materialize and no outbox to
 * drain, and running a second sync loop beside the today screen would race it. This only reads.
 */
type Grove = GroveView & { status: 'loading' | 'ready' };

export function useGrove(session: DeviceSession): Grove {
  const childId = session.child.id;
  const [grove, setGrove] = useState<Grove>(() => {
    const ownTree = { childId, firstName: null, stage: 0, isSelf: true };
    return { status: 'loading', enabled: true, trees: [ownTree], ownTree };
  });

  useFocusEffect(
    useCallback(() => {
      void (async () => {
        const db = await openDeviceDb();
        setGrove({ ...(await showGrove(db, childId)), status: 'ready' });
      })();
    }, [childId]),
  );

  return grove;
}
