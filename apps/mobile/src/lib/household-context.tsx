import { useAuth } from '@clerk/expo';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { openDeviceDb } from '@/db/client';
import { refreshFlags, startParentAnalytics } from '@/lib/analytics';
import { createApi, type Api, type Me } from '@/lib/api';

type State =
  | { status: 'loading'; me: null }
  | { status: 'error'; me: null; message: string }
  | { status: 'ready'; me: Me };

type HouseholdContextValue = State & { api: Api; refresh: () => Promise<void> };

const HouseholdContext = createContext<HouseholdContextValue | null>(null);

/**
 * Parent mode is the only mode with an identity to report and the only one that may ask for
 * feature flags; what it fetches is written through to SQLite for kid mode to read offline
 * (ADR-0009). None of it is load-bearing, so a failure here never reaches the screen.
 */
async function reportParent(me: Me): Promise<void> {
  if (!me.parent) return;
  try {
    await startParentAnalytics(me.parent.clerk_user_id, me.household?.id ?? null);
    await refreshFlags(await openDeviceDb());
  } catch {
    // The cache keeps whatever it last knew; the shipped experience is the fallback.
  }
}

/** Loads `/me` for the signed-in parent and keeps household + children in memory. */
export function HouseholdProvider({ children }: { children: React.ReactNode }) {
  const { getToken } = useAuth();
  const api = useMemo(() => createApi(() => getToken()), [getToken]);
  const [state, setState] = useState<State>({ status: 'loading', me: null });

  const refresh = useCallback(async () => {
    try {
      const me = await api.me();
      setState({ status: 'ready', me });
      void reportParent(me);
    } catch (e) {
      setState({ status: 'error', me: null, message: e instanceof Error ? e.message : 'failed' });
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
