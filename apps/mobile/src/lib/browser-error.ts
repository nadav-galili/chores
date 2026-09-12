/**
 * Telling apart the two Android browser failures `expo-web-browser` reports, because they mean
 * opposite things and one of them was read as the other (MIBO-1).
 *
 * `warmUpAsync` rejects with "Cannot determine preferred package without satisfying it" when no
 * installed app exposes a *Custom Tabs service*. That is a missed optimisation, not a verdict on
 * the phone: `openAuthSessionAsync` resolves a plain `ACTION_VIEW`, so a phone that cannot be
 * warmed up still opens a browser and still hands back through `mibo://sso-callback`.
 *
 * The genuine "no browser at all" is `NoMatchingActivityException`, thrown from the open call
 * itself when nothing resolves that intent. Only that one may take the Google option away.
 *
 * Matching is on the message rather than the code: expo-modules-core wraps the platform error and
 * the code it carries is the generic one.
 */
export function isMissingBrowser(e: unknown): boolean {
  return e instanceof Error && e.message.includes('No matching browser activity found');
}
