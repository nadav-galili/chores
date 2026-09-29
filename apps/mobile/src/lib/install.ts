import Storage from 'expo-sqlite/kv-store';
import { createDeviceApi } from '@/lib/api';
import { clearDeviceSession, getDeviceSession } from '@/lib/device-session';
import { clearRole } from '@/lib/role';

/**
 * A reinstall is a fresh start, which the secure store does not know on its own.
 *
 * Everything that makes this phone a Kid Device — the role, the device session — lives in
 * SecureStore, and on iOS that is the keychain, which the OS keeps when an app is deleted. So a
 * deleted and reinstalled Mibo opened straight back into kid mode, holding a token for a device the
 * parent thought was gone. The marker below lives where an install lives: a SQLite key/value
 * store in the app's own documents, deleted with the app and there again the next time it is put
 * back. The first launch that finds no marker is the first launch of this install, and it forgets
 * what the previous one was.
 *
 * Only the device's own state is forgotten. The language choice is a preference and keeps; the
 * parent's sign-in is Clerk's to keep or drop, and dropping it would only send a parent who
 * reinstalled through a code they already typed once.
 */
const KEY = 'mibo.installed';

let pending: Promise<void> | null = null;

/** Once per launch, before any screen reads the role or the session. */
export function forgetPreviousInstall(): Promise<void> {
  pending ??= run();
  return pending;
}

async function run(): Promise<void> {
  try {
    if ((await Storage.getItemAsync(KEY)) !== null) return;
  } catch (e) {
    // A store that cannot be read cannot be written either; keep whatever the phone has, which
    // is what every launch did before this existed.
    console.error('install marker read failed', e);
    return;
  }
  const session = await getDeviceSession();
  if (session) {
    // Best effort: the parent's device list stops calling the old install active. Offline, the
    // parent can still revoke it from their own phone.
    try {
      await createDeviceApi(session.device_token).leave();
    } catch (e) {
      console.error('device leave on reinstall failed', e);
    }
    await clearDeviceSession();
  }
  await clearRole();
  try {
    await Storage.setItemAsync(KEY, '1');
  } catch (e) {
    // Next launch forgets again, which on a phone with nothing stored costs nothing.
    console.error('install marker write failed', e);
  }
}
