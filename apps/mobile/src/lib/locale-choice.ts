import { localeSchema, type Locale } from '@chores/shared';
import * as SecureStore from 'expo-secure-store';

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
 * Remember the choice. It applies at the next launch, and nothing here hurries that along.
 *
 * `I18nManager.forceRTL` only takes effect when the app next starts — React Native lays a tree out
 * in one direction for the life of the process — so English to Hebrew cannot be a re-render, here
 * or in any other app. It used to be a reload of the JavaScript bundle, and that was worse than
 * nothing: the strings flipped at once while the native chrome kept its direction until a real
 * relaunch, and a reload starts from the app's launch URL, so a parent who had opened Mibo from a
 * deep link watched it open the same link again — a child's Join Code screen, minting a fresh
 * single-use code. The language screen asks the parent to close and reopen Mibo instead, and
 * until they do the app stays whole in the language it started in.
 */
export function chooseLocale(next: Locale): void {
  SecureStore.setItem(KEY, next);
}
