import * as SecureStore from 'expo-secure-store';

/**
 * This phone's "last seen" record for guided setup's Join Code step: the child whose step it showed
 * with no Kid Device joined yet. A parent who leaves before the device joins gets the "connected"
 * confirmation on their next open (`connectedOnOpen`), and showing it clears the record, so it is
 * seen once. A UI convenience held on this phone only, not onboarding state (spec #86).
 *
 * SecureStore because it is the app's one key/value store and reads synchronously, so the gate can
 * decide on the first render after `/me` without a loading frame of its own.
 */
const KEY = 'mibo.awaitingDevice';

export function awaitingDevice(): string | null {
  try {
    return SecureStore.getItem(KEY);
  } catch {
    // A keychain that will not answer only costs the parent a one-time confirmation screen; the
    // device is connected either way and the Today tab says so.
    return null;
  }
}

export function awaitDevice(childId: string): void {
  try {
    SecureStore.setItem(KEY, childId);
  } catch {
    // As above: the record is a convenience, and losing it loses nothing but the confirmation.
  }
}

export function stopAwaitingDevice(): void {
  void SecureStore.deleteItemAsync(KEY).catch(() => {
    // As above. A record that survives is still read against `/me`, which says the device joined,
    // so at worst the confirmation shows once more.
  });
}
