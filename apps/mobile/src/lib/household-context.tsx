import { useAuth } from '@clerk/expo';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { createApi, type Api, type Me } from '@/lib/api';

type State =
  | { status: 'loading'; me: null }
  | { status: 'error'; me: null; message: string }
  | { status: 'ready'; me: Me };

type HouseholdContextValue = State & { api: Api; refresh: () => Promise<void> };

const HouseholdContext = createContext<HouseholdContextValue | null>(null);

/** Loads `/me` for the signed-in parent and keeps household + children in memory. */
export function HouseholdProvider({ children }: { children: React.ReactNode }) {
  const { getToken } = useAuth();
  const api = useMemo(() => createApi(() => getToken()), [getToken]);
  const [state, setState] = useState<State>({ status: 'loading', me: null });

  const refresh = useCallback(async () => {
    try {
      setState({ status: 'ready', me: await api.me() });
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
