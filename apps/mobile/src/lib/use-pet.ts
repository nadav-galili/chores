import { choreDate, type DeviceSession } from '@chores/shared';
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { openDeviceDb } from '@/db/client';
import { showPet, type PetView } from '@/sync/pet';

/**
 * The pet, read from the local database and nothing else.
 *
 * Deliberately not `useToday`: the pet screen has no list to materialize and no outbox to drain,
 * and running a second sync loop beside the today screen would race it. This only reads.
 */
export function usePet(session: DeviceSession): PetView & { status: 'loading' | 'ready' } {
  const [pet, setPet] = useState<PetView & { status: 'loading' | 'ready' }>({
    status: 'loading',
    enabled: true,
    name: session.child.pet_name,
    mood: 'sleepy',
    progress: { level: 1, xp: 0, into: 0, needed: 100, fraction: 0, atMax: false },
  });

  const { tz, day_boundary_hour: boundary } = session.household;
  const childId = session.child.id;

  useFocusEffect(
    useCallback(() => {
      void (async () => {
        const db = await openDeviceDb();
        const view = await showPet(db, childId, choreDate(new Date(), tz, boundary));
        setPet({ ...view, status: 'ready' });
      })();
    }, [childId, tz, boundary]),
  );

  return pet;
}
