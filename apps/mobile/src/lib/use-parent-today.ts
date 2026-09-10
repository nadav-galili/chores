import type { ParentToday } from '@chores/shared';
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { useHousehold } from '@/lib/household-context';

/** How often the screen re-reads today while it is open (docs/spec/03-sync.md). */
export const POLL_MS = 60_000;

export type ParentTodayState = {
  status: 'loading' | 'ready' | 'error';
  today: ParentToday | null;
  /** The last read failed; what is shown is the previous read. */
  message: string | null;
};

/**
 * The parent's today view: read on open, on focus, whenever the app returns to the foreground,
 * and every 60 s while the screen is open. There is no local database on the parent side yet —
 * a parent device is online by definition of this screen — so every read is a plain GET.
 */
export function useParentToday(householdId: string | null): ParentTodayState {
  const { api } = useHousehold();
  const [today, setToday] = useState<ParentToday | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [message, setMessage] = useState<string | null>(null);
  const focused = useRef(false);

  const refresh = useCallback(async () => {
    if (!householdId) return;
    try {
      setToday(await api.today(householdId));
      setStatus('ready');
      setMessage(null);
    } catch (e) {
      setStatus('error');
      setMessage(e instanceof Error ? e.message : 'failed');
    }
  }, [api, householdId]);

  useFocusEffect(
    useCallback(() => {
      focused.current = true;
      void refresh();
      const timer = setInterval(() => void refresh(), POLL_MS);
      return () => {
        focused.current = false;
        clearInterval(timer);
      };
    }, [refresh]),
  );

  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active' && focused.current) void refresh();
    });
    return () => sub.remove();
  }, [refresh]);

  return { status, today, message };
}
