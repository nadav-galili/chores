import { Loading } from '@/components/ui';
import { ThemeProvider } from '@/theme';

/**
 * Where the OAuth browser hands control back to the app.
 *
 * The route has to exist as a real screen, and the redirect has to carry a path: expo-web-browser
 * ends the auth session by matching `event.url.startsWith(redirectUrl)`, and a pathless
 * `mibo://` arrives from Chrome as the opaque URI `mibo:?rotating_token_nonce=...`, which never
 * matches. The session then loses the race to "the app came back to the foreground" and resolves
 * as `dismiss`, dropping a sign-in that had in fact succeeded.
 *
 * Nothing happens here: `startSSOFlow()` resolves in the sign-in screen, activates the session and
 * navigates on. This is the half-second of that.
 */
export default function SSOCallback() {
  return (
    <ThemeProvider role="parent">
      <Loading />
    </ThemeProvider>
  );
}
