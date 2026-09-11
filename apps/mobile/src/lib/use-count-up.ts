import { countUpCoins } from '@chores/shared';
import { useEffect, useRef, useState } from 'react';

/**
 * A number that counts up to `value` instead of being replaced by it — the coin balance's half
 * of the done moment.
 *
 * Only while `enabled`, which the screen ties to the done moment: coins that change for any other
 * reason (the first read on open, a clawback arriving with a sync) land on the new number without
 * motion, because motion is spent on the tap and nowhere else.
 *
 * A count already running that is handed a new target carries on from where it stands rather than
 * snapping back, so a child tapping twice quickly sees one continuous climb. Where the number is
 * at any instant is `countUpCoins`, which is pure and tested; this only drives the clock.
 */
export function useCountUp(value: number, enabled: boolean): number {
  const [shown, setShown] = useState(value);
  const at = useRef(value);

  useEffect(() => {
    const from = at.current;
    if (!enabled || value <= from) {
      at.current = value;
      setShown(value);
      return;
    }
    const started = Date.now();
    let frame = requestAnimationFrame(function tick() {
      const now = countUpCoins(from, value, Date.now() - started);
      at.current = now;
      setShown(now);
      if (now < value) frame = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(frame);
  }, [value, enabled]);

  return shown;
}
