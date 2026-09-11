import type { InstanceStatus } from './materialize.ts';

/**
 * The rules of the done moment (docs/spec/06-design.md, Motion and haptics).
 *
 * Motion is spent on one moment and nowhere else, and haptics on two events inside it. The parts
 * of that which are decisions rather than drawing live here, so the device can be trusted to buzz
 * the right number of times without a UI test: what a tap is worth to the senses, whether it was
 * the tap that finished the day, and where a counting balance stands at a given instant.
 *
 * Everything here is a pure function of what the child's own device already knows — no network
 * answer is part of the moment.
 */

/** The two haptics the app is allowed to play, and nothing else ever buzzes. */
export type DoneHaptic = 'medium' | 'success';

/** One tap on a chore, as far as the child's senses are concerned. */
export type DoneTap = {
  /** The chore went done. An undo did not. */
  completed: boolean;
  /** That tap left every chore due today done. */
  dayComplete: boolean;
};

/**
 * What a tap should feel like: a medium impact for one chore, and the stronger success
 * notification for the tap that finished the day — the two are exclusive, because what makes
 * finishing everything feel different is that it answers differently, not twice.
 *
 * An undo is not a celebration and is silent, however complete the day it leaves behind is.
 */
export function doneHaptic(tap: DoneTap): DoneHaptic | null {
  if (!tap.completed) return null;
  return tap.dayComplete ? 'success' : 'medium';
}

/** The slice of today's list this needs: what is on the screen the child just tapped. */
export type TappedItem = { id: string; status: InstanceStatus };

/**
 * Does tapping `tappedId` done finish the day? True when it is the last chore on today's list
 * that is not already done — which is Day Complete's own rule, at least one due and every one of
 * them done (`day-summary.ts`), asked of the list the child is looking at.
 *
 * Read from the list rather than from the ledger on purpose: this answer is needed in the tap's
 * own tick, before any write, so the phone can answer the child immediately.
 */
export function tapCompletesTheDay(items: readonly TappedItem[], tappedId: string): boolean {
  const tapped = items.find((i) => i.id === tappedId);
  if (!tapped || tapped.status === 'done') return false;
  return items.every((i) => i.id === tappedId || i.status === 'done');
}

/**
 * Where a counting balance stands `elapsedMs` into the count from `from` to `to`: whole coins,
 * only ever rising, landing exactly on `to` at the end. Eased out, so the count is fastest when
 * it starts and settles rather than stopping dead.
 *
 * A balance that fell — an undo, a clawback that synced in — snaps. Coins going backwards is not
 * a thing to draw the child's eye to, and undo is explicitly not a celebration.
 */
export function countUpCoins(
  from: number,
  to: number,
  elapsedMs: number,
  duration: number,
): number {
  if (to <= from || duration <= 0) return to;
  if (elapsedMs <= 0) return from;
  if (elapsedMs >= duration) return to;
  const eased = 1 - Math.pow(1 - elapsedMs / duration, 3);
  return Math.min(to, from + Math.round((to - from) * eased));
}
