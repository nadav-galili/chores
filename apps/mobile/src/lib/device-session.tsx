import { deviceSessionSchema, type DeviceSession } from '@chores/shared';
import * as SecureStore from 'expo-secure-store';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

const KEY = 'device_session';

export async function getDeviceSession(): Promise<DeviceSession | null> {
  const raw = await SecureStore.getItemAsync(KEY);
  if (!raw) return null;
  const parsed = deviceSessionSchema.safeParse(JSON.parse(raw));
  return parsed.success ? parsed.data : null;
}

export async function setDeviceSession(session: DeviceSession): Promise<void> {
  await SecureStore.setItemAsync(KEY, JSON.stringify(session));
}

export async function clearDeviceSession(): Promise<void> {
  await SecureStore.deleteItemAsync(KEY);
}

type State =
  { status: 'loading'; session: null } | { status: 'ready'; session: DeviceSession | null };

type DeviceSessionValue = State & {
  save: (session: DeviceSession) => Promise<void>;
  clear: () => Promise<void>;
};

const DeviceSessionContext = createContext<DeviceSessionValue | null>(null);

/** The device token and child basics this kid device holds; survives restarts in the secure store. */
export function DeviceSessionProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<State>({ status: 'loading', session: null });

  useEffect(() => {
    getDeviceSession().then((session) => setState({ status: 'ready', session }));
  }, []);

  const save = useCallback(async (session: DeviceSession) => {
    await setDeviceSession(session);
    setState({ status: 'ready', session });
  }, []);

  const clear = useCallback(async () => {
    await clearDeviceSession();
    setState({ status: 'ready', session: null });
  }, []);

  const value = useMemo(() => ({ ...state, save, clear }), [state, save, clear]);
  return <DeviceSessionContext.Provider value={value}>{children}</DeviceSessionContext.Provider>;
}

export function useDeviceSession(): DeviceSessionValue {
  const ctx = useContext(DeviceSessionContext);
  if (!ctx) throw new Error('useDeviceSession must be used inside DeviceSessionProvider');
  return ctx;
}
