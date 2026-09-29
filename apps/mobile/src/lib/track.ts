import { buttonTapped, screenViewed } from '@chores/shared';
import { useSegments } from 'expo-router';
import { useCallback, useEffect } from 'react';
import { captureInteraction } from '@/lib/analytics';

/**
 * The route's template, not the path: `(parent)/(tabs)/children/[id]`, so an id never rides along
 * and every child's page is one screen in a funnel (ADR-0009).
 */
export function useScreenName(): string {
  return useSegments().join('/') || 'index';
}

/** Reports that a parent screen was shown, once per screen it is mounted on. */
export function useScreenViewed(): void {
  const screen = useScreenName();
  useEffect(() => {
    captureInteraction(screenViewed({ screen }));
  }, [screen]);
}

/**
 * Wraps a press handler so the tap is counted first. `button` is a constant the call site names —
 * never the label, which can hold a child's name or a parent's words. A press is never delayed or
 * lost by the report: analytics is not load-bearing.
 */
export function useTap(): <Args extends unknown[]>(
  button: string,
  handler: (...args: Args) => void,
) => (...args: Args) => void {
  const screen = useScreenName();
  return useCallback(
    (button, handler) =>
      (...args) => {
        captureInteraction(buttonTapped({ screen, button }));
        handler(...args);
      },
    [screen],
  );
}
