import type { Theme } from '@/theme';

/**
 * Screen options every stack in the app shares.
 *
 * No screen transition animates (docs/spec/06-design.md): motion is spent on the done moment and
 * nowhere else, and a parent scanning a list at 20:00 is not watching a performance. The default
 * push animation is the largest piece of motion a navigator adds for free, so it is turned off
 * here once rather than argued with per screen.
 *
 * `headerShown: false` is the child's side and the app's own root. It is not a design rule — the
 * design spec argues for the instant transition and says nothing about headers — but the kid
 * stack draws its own back affordances into the illustrations and sets `gestureEnabled: false`
 * so that nothing but `/exit` leaves kid mode, and a native header with a swipe would undo that.
 */
export const INSTANT_SCREENS = { headerShown: false, animation: 'none' } as const;

/**
 * The parent's stack, which does show headers.
 *
 * A parent screen is an admin page reached by pushing, and it was giving back as a button at the
 * bottom of the content — below the fold on any screen long enough to scroll, with no swipe
 * gesture and nothing at the top left where an iOS reader looks first. The native header supplies
 * the back button, the swipe, and the title; it also eats the top safe-area inset, which is why
 * the screens under it pass `edges="bottom"` to `Screen`.
 *
 * `animation: 'none'` survives: a header and an instant transition are independent, so the
 * spec's motion rule is untouched by this.
 */
export function parentScreens(theme: Theme) {
  return {
    animation: 'none',
    headerShown: true,
    headerBackButtonDisplayMode: 'minimal',
    headerShadowVisible: false,
    headerStyle: { backgroundColor: theme.colors.ground },
    headerTitleStyle: { color: theme.colors.text },
    headerTintColor: theme.colors.action,
  } as const;
}
