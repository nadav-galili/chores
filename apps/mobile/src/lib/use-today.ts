import { choreDate, currentStreak, type DeviceSession, type UiMode } from '@chores/shared';
import { eq } from 'drizzle-orm';
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { openDeviceDb } from '@/db/client';
import { children, daySummaries } from '@/db/schema';
import type { DeviceDb } from '@/db/types';
import { materializeToday, todayList, type TodayItem } from '@/sync/engine';
import { balanceOf, tapContext, tapToggle, type ChildContext } from '@/sync/local';
import { clearRejectedOps, rejectedOps } from '@/sync/outbox';
import { syncNow } from '@/sync/sync';
import { ApiError, createDeviceApi } from '@/lib/api';

export type TodayState = {
  status: 'loading' | 'ready';
  /** From the local child row once pulled, else what the join code told us. */
  firstName: string;
  uiMode: UiMode;
  items: TodayItem[];
  streak: number;
  /** Balance, always the sum of the local ledger. */
  coins: number;
  /** The last sync failed; the list is whatever is local. Cleared by the next good sync. */
  offline: boolean;
  /** Taps the server refused. They are never retried, so the child has to be told. */
  refused: number;
};

export type Today = TodayState & {
  /** Tap a chore: done, or undone if it was already done. Counts locally before any network. */
  toggle: (item: TodayItem) => void;
  /** The child has seen the refusals; stop showing them. */
  dismissRefused: () => void;
};

/**
 * Today's list, read from SQLite only: materialize today, show it, then sync and show it again.
 * Runs on open, on focus, whenever the app returns to the foreground, and after every tap.
 */
export function useToday(session: DeviceSession, onRevoked: () => void): Today {
  const [state, setState] = useState<TodayState>({
    status: 'loading',
    firstName: session.child.first_name,
    uiMode: session.child.ui_mode,
    items: [],
    streak: 0,
    coins: 0,
    offline: false,
    refused: 0,
  });
  const revoked = useRef(onRevoked);
  revoked.current = onRevoked;

  const { tz, day_boundary_hour: boundary } = session.household;
  const { id: childId, ui_mode: joinedUiMode, first_name: joinedName } = session.child;

  const child: ChildContext = useMemo(
    () => ({
      householdId: session.household.id,
      childId,
      deviceId: session.device_id,
      tz,
      dayBoundaryHour: boundary,
    }),
    [session.household.id, childId, session.device_id, tz, boundary],
  );

  const readLocal = useCallback(
    async (db: DeviceDb, offline: boolean) => {
      const date = choreDate(new Date(), tz, boundary);
      await materializeToday(db, childId, date);
      const [items, rows, summaries, coins, refused] = await Promise.all([
        todayList(db, childId, date),
        db.select().from(children).where(eq(children.id, childId)),
        db.select().from(daySummaries).where(eq(daySummaries.child_id, childId)),
        balanceOf(db, childId),
        rejectedOps(db),
      ]);
      setState({
        status: 'ready',
        firstName: rows[0]?.first_name ?? joinedName,
        uiMode: rows[0]?.ui_mode ?? joinedUiMode,
        items,
        streak: currentStreak(summaries, date),
        coins,
        offline,
        refused: refused.length,
      });
    },
    [childId, tz, boundary, joinedUiMode, joinedName],
  );

  const refresh = useCallback(async () => {
    const db = await openDeviceDb();
    await readLocal(db, false);
    try {
      await syncNow(db, child, createDeviceApi(session.device_token).sync);
      await readLocal(db, false);
    } catch (e) {
      if (e instanceof ApiError && e.code === 'device_revoked') return revoked.current();
      await readLocal(db, true);
    }
  }, [readLocal, child, session.device_token]);

  const toggle = useCallback(
    (item: TodayItem) => {
      void (async () => {
        const db = await openDeviceDb();
        await tapToggle(db, tapContext(child), item);
        // The child sees the new coins and streak before anything reaches the network.
        await readLocal(db, state.offline);
        await refresh();
      })();
    },
    [child, readLocal, refresh, state.offline],
  );

  const dismissRefused = useCallback(() => {
    void (async () => {
      const db = await openDeviceDb();
      await clearRejectedOps(db);
      await readLocal(db, state.offline);
    })();
  }, [readLocal, state.offline]);

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

  return { ...state, toggle, dismissRefused };
}
