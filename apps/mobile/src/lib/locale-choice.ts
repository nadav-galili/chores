import { localeSchema, type Locale } from '@chores/shared';
import * as SecureStore from 'expo-secure-store';
import * as Updates from 'expo-updates';
import { DevSettings } from 'react-native';

/**
 * The language a parent picked, which outranks the phone's own.
 *
 * Stored rather than derived because the point of picking is that it survives: a household reading
 * Hebrew on an English phone should not have to change the phone. It lives in SecureStore, which
 * is not about secrecy here — it is the app's only key/value store, and its `getItem` is
 * synchronous, which is the requirement that decides this. `lib/i18n` reads the locale while its
 * module body runs, before any screen mounts, and an async read would have it choosing a language
 * one frame after the first screen had already been laid out in the other direction.
 */
const KEY = 'mibo.locale';

/** The stored choice, or null when the family has never made one. */
export function storedLocale(): Locale | null {
  try {
    const parsed = localeSchema.safeParse(SecureStore.getItem(KEY));
    return parsed.success ? parsed.data : null;
  } catch {
    // A keychain that will not answer is a phone that reads its own language. Nothing to report:
    // there is no session yet to attach it to, and the fallback is the behaviour we had before
    // any of this existed.
    return null;
  }
}

/**
 * Remember the choice and restart into it.
 *
 * The restart is not a shortcut. `I18nManager.forceRTL` only takes effect when the app next
 * starts — React Native lays a tree out in one direction for the life of the process — so English
 * to Hebrew cannot be a re-render, here or in any other app. Since the direction has to restart,
 * the strings ride along with it rather than being threaded through a context that every screen
 * would have to subscribe to for the one flip in the app's life a family performs.
 */
export async function chooseLocale(next: Locale): Promise<void> {
  SecureStore.setItem(KEY, next);
  try {
    await Updates.reloadAsync();
  } catch {
    // No update runtime in a development client, where reloading is the dev server's job.
    DevSettings.reload();
  }
}
