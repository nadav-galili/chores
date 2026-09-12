import { NO_PIN_ATTEMPTS, pinAttemptsSchema, type PinAttempts } from '@chores/shared';
import * as SecureStore from 'expo-secure-store';

const KEY = 'pin_attempts';

/**
 * How many wrong PINs this device has taken, and until when it is closed. It lives in the secure
 * store rather than in state so a restart does not clear the cooldown (ADR-0013) — the restart is
 * the first thing a child tries. A store that cannot be read says so and starts the count over:
 * the device is the only place this can be kept, and a screen that will not open at all is worse
 * than one a determined child waits out.
 */
export async function readPinAttempts(): Promise<PinAttempts> {
  try {
    const raw = await SecureStore.getItemAsync(KEY);
    if (!raw) return NO_PIN_ATTEMPTS;
    const parsed = pinAttemptsSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : NO_PIN_ATTEMPTS;
  } catch (e: unknown) {
    console.error('pin attempts read failed', e);
    return NO_PIN_ATTEMPTS;
  }
}

export async function writePinAttempts(attempts: PinAttempts): Promise<void> {
  try {
    await SecureStore.setItemAsync(KEY, JSON.stringify(attempts));
  } catch (e: unknown) {
    console.error('pin attempts write failed', e);
  }
}
