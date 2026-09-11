import { useEffect, useRef } from 'react';
import { Animated, Easing } from 'react-native';

/**
 * The done moment's clock, in one place (docs/spec/06-design.md). Nothing else in the app
 * animates, so nothing else imports this file.
 *
 * Every animation built here runs on the native driver: the tap's write to SQLite and the outbox
 * happens on the JS thread in the same tick, and the moment must not be able to delay it — nor be
 * stuttered by it.
 */
export const MOTION = {
  /** A thing arriving: the row's pop, the pet's bounce, the card coming up. */
  in: 220,
  /** The same thing settling back. */
  out: 180,
  /** How long the card holds before it goes, and how long it holds when a tree came with it. */
  hold: 700,
  holdGrew: 1300,
  /** A tree pushing up out of nothing. */
  grow: 520,
} as const;

/**
 * A pop: 0 → 1 → 0, played each time `fire` goes true. Returns the value to interpolate — a
 * scale, usually — which rests at 0 the rest of the time.
 *
 * By default a `fire` that is already true on the first render plays nothing: a chore row that
 * arrives on screen done is today's list as it stands, not a tap. `onMount` is for the things
 * that are mounted *by* the tap and so have no rising edge to wait for.
 *
 * `fire` going false plays nothing either way. An undo is not a celebration, so the row it
 * un-does simply returns to how it was.
 */
export function usePop(
  fire: boolean,
  { delay = 0, onMount = false }: { delay?: number; onMount?: boolean } = {},
): Animated.Value {
  const pop = useRef(new Animated.Value(0)).current;
  const mounted = useRef(onMount);

  useEffect(() => {
    // A list re-rendering, or a screen coming back, is not a tap: only a rising edge is.
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    if (!fire) {
      pop.setValue(0);
      return;
    }
    const animation = Animated.sequence([
      Animated.delay(delay),
      Animated.timing(pop, {
        toValue: 1,
        duration: MOTION.in,
        easing: Easing.out(Easing.back(2)),
        useNativeDriver: true,
      }),
      Animated.timing(pop, {
        toValue: 0,
        duration: MOTION.out,
        easing: Easing.in(Easing.quad),
        useNativeDriver: true,
      }),
    ]);
    animation.start();
    return () => animation.stop();
  }, [fire, delay, pop]);

  return pop;
}

/**
 * A thing growing into place and staying: 0 → 1 when `on` turns true, and back to 0 with no
 * animation when it turns false. The tree's, on the tap that planted it.
 */
export function useRise(on: boolean): Animated.Value {
  const rise = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!on) {
      rise.setValue(0);
      return;
    }
    const animation = Animated.timing(rise, {
      toValue: 1,
      duration: MOTION.grow,
      easing: Easing.out(Easing.back(1.4)),
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [on, rise]);

  return rise;
}
