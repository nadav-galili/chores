import { getRandomValues } from 'expo-crypto';

/**
 * Gives Hermes the one piece of WebCrypto this app uses.
 *
 * `uuid7()` in `@chores/shared` calls `crypto.getRandomValues` — the API and the tests get it
 * from Node, and Hermes has no `crypto` at all. `expo-crypto` exports the function but installs
 * no global, so the assignment has to happen here, and it has to happen before the first id is
 * generated: every write the app makes — a chore, a completion, an outbox op — needs one. Without
 * it the app reads fine and silently cannot write anything, which is exactly how this was found.
 *
 * Imported for its side effect at the root layout, so it runs once, before any screen.
 */
if (typeof globalThis.crypto === 'undefined') {
  // Only the member `uuid7` needs; this is a shim, not an implementation of WebCrypto.
  (globalThis as { crypto?: unknown }).crypto = { getRandomValues };
}
