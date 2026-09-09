import { choreDate, currentStreak, type DeviceSession, type UiMode } from '@chores/shared';
import { eq } from 'drizzle-orm';
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { openDeviceDb } from '@/db/client';
import { children, daySummaries } from '@/db/schema';
import type { DeviceDb } from '@/db/types';
import { materializeToday, todayList, type TodayItem } from '@/sync/engine';
import { pull } from '@/sync/pull';
import { ApiError, createDeviceApi } from '@/lib/api';

export type TodayState = {
  status: 'loading' | 'ready';
  /** From the local child row once pulled, else what the join code told us. */
  firstName: string;
  uiMode: UiMode;
  items: TodayItem[];
  streak: number;
  /** The last pull failed; the list is whatever is local. Cleared by the next good pull. */
  offline: boolean;
};

/**
 * Today's list, read from SQLite only: materialize today, show it, then pull and show it again.
 * Runs on open, on focus and whenever the app returns to the foreground.
 */
export function useToday(session: DeviceSession, onRevoked: () => void): TodayState {
  const [state, setState] = useState<TodayState>({
    status: 'loading',
    firstName: session.child.first_name,
    uiMode: session.child.ui_mode,
    items: [],
    streak: 0,
    offline: false,
  });
  const revoked = useRef(onRevoked);
  revoked.current = onRevoked;

  const { tz, day_boundary_hour: boundary } = session.household;
  const { id: childId, ui_mode: joinedUiMode, first_name: joinedName } = session.child;

  const readLocal = useCallback(
    async (db: DeviceDb, offline: boolean) => {
      const date = choreDate(new Date(), tz, boundary);
      await materializeToday(db, childId, date);
      const [items, child, summaries] = await Promise.all([
        todayList(db, childId, date),
        db.select().from(children).where(eq(children.id, childId)),
        db.select().from(daySummaries).where(eq(daySummaries.child_id, childId)),
      ]);
      setState({
        status: 'ready',
        firstName: child[0]?.first_name ?? joinedName,
        uiMode: child[0]?.ui_mode ?? joinedUiMode,
        items,
        streak: currentStreak(summaries, date),
        offline,
      });
    },
    [childId, tz, boundary, joinedUiMode, joinedName],
  );

  const refresh = useCallback(async () => {
    const db = await openDeviceDb();
    await readLocal(db, false);
    try {
      await pull(db, session.device_id, createDeviceApi(session.device_token).sync);
      await readLocal(db, false);
    } catch (e) {
      if (e instanceof ApiError && e.code === 'device_revoked') return revoked.current();
      await readLocal(db, true);
    }
  }, [readLocal, session.device_id, session.device_token]);

  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh]),
  );

  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') void refresh();
    });
    return () => sub.remove();
  }, [refresh]);

  return state;
}
