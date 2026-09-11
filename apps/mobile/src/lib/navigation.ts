/**
 * Screen options every stack in the app shares.
 *
 * No screen transition animates (docs/spec/06-design.md): motion is spent on the done moment and
 * nowhere else, and a parent scanning a list at 20:00 is not watching a performance. The default
 * push animation is the largest piece of motion a navigator adds for free, so it is turned off
 * here once rather than argued with per screen.
 */
export const INSTANT_SCREENS = { headerShown: false, animation: 'none' } as const;
