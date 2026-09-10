import {
  COINS_PER_CHORE,
  choreDate,
  currentStreak,
  type DeviceSession,
  type UiMode,
} from '@chores/shared';
import { eq } from 'drizzle-orm';
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { openDeviceDb } from '@/db/client';
import { children, daySummaries } from '@/db/schema';
import type { DeviceDb } from '@/db/types';
import { materializeToday, todayList, type TodayItem } from '@/sync/engine';
import { balanceOf, tapContext, tapToggle, type ChildContext } from '@/sync/local';
import { serverHoldsToken } from '@/sync/notifications';
import { clearRejectedOps, rejectedOps } from '@/sync/outbox';
import { showPet, type PetView } from '@/sync/pet';
import { syncNow } from '@/sync/sync';
import { ApiError, createDeviceApi } from '@/lib/api';
import { arrangeKidReminder } from '@/lib/notifications';

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
  /** Level, mood and XP bar, from the shared rules over local rows. */
  pet: PetView & { name: string };
  /** The reminder time the parent set, from the child row; drives the local notification. */
  reminderTime: string | null;
  /** The server holds this device's push token, so the reminder is a push and not a local one. */
  pushRegistered: boolean;
};

/**
 * One done moment: what the child sees the instant they tap. Created synchronously in the tap
 * handler, before any database work, so the pet starts reacting in the same frame as the tap
 * (the `pet_reacted` event measures from `at` in a later ticket).
 */
export type DoneReaction = {
  /** New on every tap, so a second tap restarts the animation. */
  key: number;
  /** What the tap paid. Starts at the per-chore rate and rises if the tap completed the day. */
  coins: number;
  /** `Date.now()` at the tap itself. */
  at: number;
};

export type Today = TodayState & {
  /** Tap a chore: done, or undone if it was already done. Counts locally before any network. */
  toggle: (item: TodayItem) => void;
  /** The child has seen the refusals; stop showing them. */
  dismissRefused: () => void;
  /** The done moment to play, or null. Set in the same tick as the tap. */
  reaction: DoneReaction | null;
  /** The animation has finished playing. */
  clearReaction: () => void;
};

/** What the header draws before the first read lands; the name comes from the join. */
const PET_PLACEHOLDER: Omit<PetView, 'name'> = {
  enabled: true,
  mood: 'sleepy',
  progress: { level: 1, xp: 0, into: 0, needed: 100, fraction: 0, atMax: false },
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
    pet: { ...PET_PLACEHOLDER, name: session.child.pet_name },
    reminderTime: null,
    pushRegistered: false,
  });
  const [reaction, setReaction] = useState<DoneReaction | null>(null);
  const taps = useRef(0);
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
      const [items, rows, summaries, coins, refused, pet, pushRegistered] = await Promise.all([
        todayList(db, childId, date),
        db.select().from(children).where(eq(children.id, childId)),
        db.select().from(daySummaries).where(eq(daySummaries.child_id, childId)),
        balanceOf(db, childId),
        rejectedOps(db),
        showPet(db, childId, date),
        serverHoldsToken(db),
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
        pet: { ...pet, name: pet.name ?? session.child.pet_name },
        reminderTime: rows[0]?.reminder_time ?? null,
        pushRegistered,
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
      // Start the done moment in this very tick: the pet must react to the tap, not to SQLite.
      // Undoing is not a celebration, so only a chore going done gets one.
      if (item.status !== 'done') {
        setReaction({ key: (taps.current += 1), coins: COINS_PER_CHORE, at: Date.now() });
      }
      void (async () => {
        const db = await openDeviceDb();
        const paid = await tapToggle(db, tapContext(child), item);
        // The child sees the new coins and streak before anything reaches the network.
        await readLocal(db, state.offline);
        // A tap that completed the day paid a bonus too. The animation is already running; this
        // only corrects the number on it, from what the tap itself wrote.
        if (paid > COINS_PER_CHORE) {
          setReaction((r) => (r === null ? r : { ...r, coins: paid }));
        }
        await refresh();
      })();
    },
    [child, readLocal, refresh, state.offline],
  );

  const clearReaction = useCallback(() => setReaction(null), []);

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

  // The reminder is arranged once the child row says what it should be, again whenever a parent
  // moves it, and again when the server takes this device's token — which is what turns the local
  // notification off. Not on every refresh: reading the push token is a call to Expo.
  useEffect(() => {
    void (async () => {
      await arrangeKidReminder(await openDeviceDb(), { tz, reminderTime: state.reminderTime });
    })();
  }, [tz, state.reminderTime, state.pushRegistered]);

  return { ...state, toggle, dismissRefused, reaction, clearReaction };
}
