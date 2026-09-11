import {
  COINS_PER_CHORE,
  choreCompleted,
  choreDate,
  currentStreak,
  groveGrew,
  kidAppOpen,
  kidDayComplete,
  petReacted,
  tapCompletesTheDay,
  type DeviceSession,
  type IsoDate,
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
import { showGrove, type GroveView } from '@/sync/grove';
import { showPet, type PetView } from '@/sync/pet';
import { syncNow } from '@/sync/sync';
import { markDayComplete, markGroveStage, markOpen } from '@/sync/analytics';
import { ApiError, createDeviceApi } from '@/lib/api';
import { analyticsReady, capture, startKidAnalytics } from '@/lib/analytics';
import { playDoneHaptic } from '@/lib/haptics';
import { arrangeKidReminder } from '@/lib/notifications';

export type TodayState = {
  status: 'loading' | 'ready';
  /** From the local child row once pulled, else what the join code told us. */
  firstName: string;
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
  /** One tree per child, from the growth entries on this device. */
  grove: GroveView;
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
  /** The tap completed the day, so it planted a tree; the grove reacts too. */
  grew: boolean;
  /**
   * The tap's own local write has reported, so `coins` and `grew` are final. Until it has, the
   * moment stays on screen: the card may not leave before the tree it might have planted has had
   * its chance to appear. Only SQLite is waited on — never the network.
   */
  settled: boolean;
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

/** What the header draws before the first read lands: the child's own tree, not yet counted. */
const grovePlaceholder = (childId: string): GroveView => {
  const ownTree = { childId, firstName: null, stage: 0, isSelf: true };
  return { enabled: true, trees: [ownTree], ownTree };
};

/**
 * What the local rows have just said, reported once each (ADR-0009). Every one of these is a
 * question about a day or a threshold, and this runs on every open, every focus and after every
 * tap, so what makes them events rather than readings is the device's own record of what it has
 * already said — see `sync/analytics`.
 *
 * Nothing is marked as said before there is anywhere to say it: this runs on the first read,
 * which can beat the client coming up, and a day marked open without an event would be a day
 * silently lost.
 */
async function reportDay(
  db: DeviceDb,
  today: IsoDate,
  day: { complete: boolean; streak: number; stage: number },
): Promise<void> {
  if (!analyticsReady()) return;
  if (await markOpen(db, today)) capture(kidAppOpen());
  if (day.complete && (await markDayComplete(db, today))) {
    capture(kidDayComplete({ streak: day.streak }));
  }
  if (await markGroveStage(db, day.stage)) capture(groveGrew({ stage: day.stage }));
}

/**
 * Today's list, read from SQLite only: materialize today, show it, then sync and show it again.
 * Runs on open, on focus, whenever the app returns to the foreground, and after every tap.
 */
export function useToday(session: DeviceSession, onRevoked: () => void): Today {
  const [state, setState] = useState<TodayState>({
    status: 'loading',
    firstName: session.child.first_name,
    items: [],
    streak: 0,
    coins: 0,
    offline: false,
    refused: 0,
    pet: { ...PET_PLACEHOLDER, name: session.child.pet_name },
    grove: grovePlaceholder(session.child.id),
    reminderTime: null,
    pushRegistered: false,
  });
  const [reaction, setReaction] = useState<DoneReaction | null>(null);
  const taps = useRef(0);
  // The child's own Grove Stage as of the last read. A tap that raises it planted a tree, which
  // is the only honest signal for the done moment: coins and trees are separate quantities from
  // one event (ADR-0004, ADR-0011), so a coin total cannot stand in for a Day Complete.
  const stage = useRef(0);
  const revoked = useRef(onRevoked);
  revoked.current = onRevoked;

  const { tz, day_boundary_hour: boundary } = session.household;
  const { id: childId, first_name: joinedName } = session.child;

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
      const [items, rows, summaries, coins, refused, pet, grove, pushRegistered] =
        await Promise.all([
          todayList(db, childId, date),
          db.select().from(children).where(eq(children.id, childId)),
          db.select().from(daySummaries).where(eq(daySummaries.child_id, childId)),
          balanceOf(db, childId),
          rejectedOps(db),
          showPet(db, childId, date),
          showGrove(db, childId),
          serverHoldsToken(db),
        ]);
      stage.current = grove.ownTree.stage;
      const streak = currentStreak(summaries, date);
      setState({
        status: 'ready',
        firstName: rows[0]?.first_name ?? joinedName,
        items,
        streak,
        coins,
        offline,
        refused: refused.length,
        pet: { ...pet, name: pet.name ?? session.child.pet_name },
        grove,
        reminderTime: rows[0]?.reminder_time ?? null,
        pushRegistered,
      });
      await reportDay(db, date, {
        complete: summaries.some((s) => s.chore_date === date && s.complete),
        streak,
        stage: grove.ownTree.stage,
      });
    },
    [childId, tz, boundary, joinedName],
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
      const completed = item.status !== 'done';
      // Whether this is the tap that finished the day, read off the list the child is looking at
      // — the same answer the ledger reaches a moment later, but available now, which is what the
      // phone needs to answer the stronger way at the instant of the tap rather than after a
      // write. The tree still waits for the row the write plants; the buzz does not.
      playDoneHaptic({ completed, dayComplete: tapCompletesTheDay(state.items, item.id) });
      if (completed) {
        setReaction({
          key: (taps.current += 1),
          coins: COINS_PER_CHORE,
          at: Date.now(),
          grew: false,
          settled: false,
        });
      }
      // The correction this tap's own write owes the moment already running, applied once. Keyed,
      // so a tap that lands while an older one is still writing corrects nobody else's moment.
      const key = taps.current;
      const settle = (correction: Partial<DoneReaction>) =>
        setReaction((r) =>
          r === null || r.key !== key || r.settled ? r : { ...r, ...correction, settled: true },
        );
      void (async () => {
        const grown = stage.current;
        try {
          const db = await openDeviceDb();
          const paid = await tapToggle(db, tapContext(child), item);
          // The tap has counted, in SQLite, whether or not there is a network — which is the whole
          // offline promise, and why the event carries whether there was one.
          if (completed) capture(choreCompleted({ offline: state.offline }));
          // The child sees the new coins, streak and tree before anything reaches the network.
          await readLocal(db, state.offline);
          // A tap that completed the day paid a bonus and planted a tree — the two are asked
          // separately because they are separate quantities (ADR-0004, ADR-0011).
          settle({ coins: paid, grew: stage.current > grown });
          await refresh();
        } finally {
          // A write that threw still has to let the moment go, or the card would never leave.
          settle({});
        }
      })();
    },
    [child, readLocal, refresh, state.items, state.offline],
  );

  // How long the child waited for the pet: the reaction is created in the tap's own tick, so the
  // first render carrying it is the frame the pet appears in. Once per tap, by its key.
  useEffect(() => {
    if (reaction) capture(petReacted({ tapped_at: reaction.at, shown_at: Date.now() }));
    // The key changes on every tap; nothing else about the reaction re-fires this.
  }, [reaction?.key]);

  const clearReaction = useCallback(() => setReaction(null), []);

  const dismissRefused = useCallback(() => {
    void (async () => {
      const db = await openDeviceDb();
      await clearRejectedOps(db);
      await readLocal(db, state.offline);
    })();
  }, [readLocal, state.offline]);

  // This device's analytics identity: the anon id from its join, and nothing about the child
  // (ADR-0009). Kid mode never asks PostHog for anything, so there is nothing to await.
  useEffect(() => {
    void startKidAnalytics(session);
  }, [session.analytics_anon_id, session.child.ui_mode, session.household.id]);

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
