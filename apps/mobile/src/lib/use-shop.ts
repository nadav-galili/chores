import { rewardRequested, type DeviceSession } from '@chores/shared';
import { useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { openDeviceDb } from '@/db/client';
import type { DeviceDb } from '@/db/types';
import { tapContext, type ChildContext } from '@/sync/local';
import { askForReward, cancelRedemption } from '@/sync/redeem';
import { showShop, type ShopRequest, type ShopReward, type ShopView } from '@/sync/shop';
import { syncNow } from '@/sync/sync';
import { capture } from '@/lib/analytics';
import { ApiError, createDeviceApi } from '@/lib/api';

/**
 * The reward shop: read from SQLite, written to SQLite, and synced afterwards.
 *
 * Every tap counts locally before anything reaches the network — the coins leave the ledger the
 * moment the child asks (ADR-0014), so the balance on screen is what is left to spend whether or
 * not the phone has a signal. The sync that follows is how a parent hears about it, and a request
 * made offline simply waits in the outbox.
 *
 * Not `useToday`: a shop request is not a completion, so there is no done moment, no pet and no
 * grove to settle. The shape of the write is the same one — local first, network after.
 */
type ShopState = ShopView & { status: 'loading' | 'ready' };

export type Shop = ShopState & {
  /** Ask for a reward. Refused locally when the balance does not cover it. */
  ask: (reward: ShopReward) => void;
  /** Change your mind, while it is still yours to change. */
  cancel: (request: ShopRequest) => void;
};

export function useShop(session: DeviceSession, onRevoked: () => void): Shop {
  const [state, setState] = useState<ShopState>({
    status: 'loading',
    coins: 0,
    rewards: [],
    requests: [],
  });

  const { id: childId } = session.child;
  const { tz, day_boundary_hour: boundary } = session.household;

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

  const read = useCallback(
    async (db: DeviceDb) => setState({ ...(await showShop(db, childId)), status: 'ready' }),
    [childId],
  );

  const refresh = useCallback(async () => {
    const db = await openDeviceDb();
    await read(db);
    try {
      await syncNow(db, child, createDeviceApi(session.device_token).sync);
      await read(db);
    } catch (e) {
      if (e instanceof ApiError && e.code === 'device_revoked') return onRevoked();
      // The shop is drawn from local rows, so a failed sync changes nothing the child can see.
      // It is said out loud rather than swallowed: a request that never leaves the outbox is a
      // parent who is never asked.
      console.error('shop sync failed', e);
    }
  }, [read, child, session.device_token, onRevoked]);

  /** One tap: write it locally, show the result, then let the network catch up. */
  const tap = useCallback(
    (write: (db: DeviceDb) => Promise<void>) => {
      void (async () => {
        try {
          const db = await openDeviceDb();
          await write(db);
          await read(db);
        } catch (e) {
          // A tap that cannot be written would otherwise leave the row exactly as it was, with
          // nothing to say why. The child is told nothing — there is nothing they can do — but
          // the device says it.
          console.error('shop tap failed to write', e);
        }
        await refresh();
      })();
    },
    [read, refresh],
  );

  const ask = useCallback(
    (reward: ShopReward) =>
      tap(async (db) => {
        const result = await askForReward(db, tapContext(child), reward);
        // A custom reward (M3) has no key and sends nothing rather than sending a parent's own
        // words; a refusal is not a request, so it is not reported as one.
        if (result.ok && reward.builtin_key) {
          capture(
            rewardRequested({ builtin_key: reward.builtin_key, cost_coins: reward.cost_coins }),
          );
        }
      }),
    [tap, child],
  );

  const cancel = useCallback(
    (request: ShopRequest) =>
      tap(async (db) => {
        await cancelRedemption(db, tapContext(child), request.id);
      }),
    [tap, child],
  );

  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh]),
  );

  return { ...state, ask, cancel };
}
