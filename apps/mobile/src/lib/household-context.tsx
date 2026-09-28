import { useAuth } from '@clerk/expo';
import type { Gate } from '@chores/shared';
import { useRouter } from 'expo-router';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { openDeviceDb } from '@/db/client';
import { refreshFlags, startParentAnalytics } from '@/lib/analytics';
import { createApi, type Api, type Me } from '@/lib/api';
import { setParentErrorContext } from '@/lib/error-reporting';
import { registerParentPush } from '@/lib/notifications';
import { configurePurchases } from '@/lib/purchases';

type State =
  | { status: 'loading'; me: null }
  | { status: 'error'; me: null; message: string }
  | { status: 'ready'; me: Me };

type HouseholdContextValue = State & {
  api: Api;
  /** Re-reads `/me`; resolves to what it read, or null when that failed (the state says why). */
  refresh: () => Promise<Me | null>;
};

const HouseholdContext = createContext<HouseholdContextValue | null>(null);

/**
 * Parent mode is the only mode with an identity to report and the only one that may ask for
 * feature flags; what it fetches is written through to SQLite for kid mode to read offline
 * (ADR-0009). None of it is load-bearing, so a failure here never reaches the screen.
 */
async function reportParent(me: Me): Promise<void> {
  if (!me.parent) return;
  setParentErrorContext(me.parent.clerk_user_id);
  void configurePurchases(me.parent.clerk_user_id).catch((e) => {
    // Purchase configuration is retried when the paywall opens; a missing dashboard key must not
    // keep the rest of the parent app from loading.
    console.error('RevenueCat configuration failed', e);
  });
  try {
    await startParentAnalytics(me.parent.clerk_user_id, me.household?.id ?? null);
    await refreshFlags(await openDeviceDb());
  } catch (e) {
    // The cache keeps whatever it last knew; the shipped experience is the fallback — so the
    // parent is told nothing. The device still says why, because a flag set that silently never
    // arrives looks exactly like a flag set that arrived and said no.
    console.error('parent analytics/flags failed', e);
  }
}

/** Loads `/me` for the signed-in parent and keeps household + children in memory. */
export function HouseholdProvider({ children }: { children: React.ReactNode }) {
  const { getToken } = useAuth();
  const router = useRouter();
  const onGate = useCallback(
    (gate: Gate) => router.push({ pathname: '/paywall', params: { gate } }),
    [router],
  );
  // Clerk hands back a new `getToken` on every render. Reading it through a ref keeps `api` (and
  // so `refresh`) stable; keyed on `getToken` directly, every render rebuilt `api`, re-ran the
  // `/me` effect, and reset any screen effect that depends on `api` before its timer could fire.
  const getTokenRef = useRef(getToken);
  getTokenRef.current = getToken;
  const api = useMemo(() => createApi(() => getTokenRef.current(), onGate), [onGate]);
  const [state, setState] = useState<State>({ status: 'loading', me: null });

  const refresh = useCallback(async () => {
    try {
      const me = await api.me();
      setState({ status: 'ready', me });
      void reportParent(me);
      const householdId = me.household?.id;
      // Every open re-registers this phone for push; `registerParentPush` swallows its own
      // failures, so a refusal never reaches the screen the parent is waiting on.
      if (householdId) void registerParentPush((input) => api.registerDevice(householdId, input));
      return me;
    } catch (e) {
      setState({ status: 'error', me: null, message: e instanceof Error ? e.message : 'failed' });
      return null;
    }
  }, [api]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const value = useMemo(() => ({ ...state, api, refresh }), [state, api, refresh]);
  return <HouseholdContext.Provider value={value}>{children}</HouseholdContext.Provider>;
}

export function useHousehold(): HouseholdContextValue {
  const ctx = useContext(HouseholdContext);
  if (!ctx) throw new Error('useHousehold must be used inside HouseholdProvider');
  return ctx;
}

/** The household's id once `/me` has loaded with one; undefined before, and without one. */
export function useHouseholdId(): string | undefined {
  const state = useHousehold();
  return state.status === 'ready' ? state.me.household?.id : undefined;
}

/** One of the household's children by id, once `/me` has loaded; undefined for any other id. */
export function useHouseholdChild(id: string | undefined): Me['children'][number] | undefined {
  const state = useHousehold();
  return state.status === 'ready' ? state.me.children.find((c) => c.id === id) : undefined;
}
