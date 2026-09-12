import {
  kidReminderCopy,
  localTimeFor,
  openedNotificationKind,
  type ParentDeviceInput,
} from '@chores/shared';
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { capturePushOpened } from '@/lib/analytics';
import { locale, t } from '@/lib/i18n';
import type { DeviceDb } from '@/db/types';
import {
  registerPushToken,
  scheduleReminder,
  serverHoldsToken,
  type ReminderScheduler,
} from '@/sync/notifications';

/**
 * The kid reminder on the device (docs/spec/01-product.md, notifications). The child is nudged at
 * the time their parent set: by push once the server holds this device's token, and until then by
 * a local notification the device schedules itself, which needs neither a network nor push
 * credentials. Exactly one of the two is armed at a time, so the child is never nudged twice.
 *
 * This module is the only place expo-notifications is touched; the decisions live in
 * `src/sync/notifications.ts`.
 */

/** One reminder per device: scheduling again under this id replaces what is already there. */
const REMINDER_ID = 'kid-reminder';
const CHANNEL_ID = 'reminders';

async function permitted(): Promise<boolean> {
  const current = await Notifications.getPermissionsAsync();
  if (current.granted) return true;
  if (!current.canAskAgain) return false;
  return (await Notifications.requestPermissionsAsync()).granted;
}

/** Android shows nothing that does not belong to a channel. */
async function ensureChannel(): Promise<void> {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
    name: t('notifications.channel'),
    importance: Notifications.AndroidImportance.DEFAULT,
  });
}

/**
 * Fires every day at the reminder time, until it is replaced. The trigger is a wall clock on this
 * device and the reminder time is a household-local one, so it is converted: a child on holiday
 * in another zone is still nudged at the hour their parent set at home.
 */
const localReminder =
  (tz: string): ReminderScheduler =>
  async (time) => {
    await Notifications.cancelScheduledNotificationAsync(REMINDER_ID);
    if (!time) return;
    const { hour, minute } = localTimeFor(time, tz);
    await Notifications.scheduleNotificationAsync({
      identifier: REMINDER_ID,
      content: kidReminderCopy(locale),
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DAILY,
        channelId: CHANNEL_ID,
        hour,
        minute,
      },
    });
  };

/**
 * Arms this device's reminder the way the child row asks for, and re-registers its push token: a
 * token rots, so it is read on every open and sent on only the opens where it changed. Safe to
 * call whenever the child row is read — everything in here is a no-op once it agrees with what the
 * device has already arranged.
 */
export async function arrangeKidReminder(
  db: DeviceDb,
  child: { tz: string; reminderTime: string | null },
  now = new Date(),
): Promise<void> {
  if (!(await permitted())) return;
  await ensureChannel();

  const projectId = Constants.expoConfig?.extra?.eas?.projectId as string | undefined;
  if (projectId) {
    try {
      const { data } = await Notifications.getExpoPushTokenAsync({ projectId });
      await registerPushToken(db, { token: data, locale }, now);
    } catch (e) {
      // Offline, or no push credentials yet: the local reminder below stays the delivery until an
      // open that reaches Expo. Nothing about the child's day depends on this, so nothing reaches
      // the screen — but a build with the credentials wrong fails here every time and would
      // otherwise look identical to a phone that is merely offline. Only the error goes to the
      // console, never `data`; it stays on the device, which is what keeps it clear of ADR-0009.
      console.error('push token registration failed', e);
    }
  }

  // The server pushes once it holds the token; the local notification covers every case where it
  // does not, so only one of the two is ever scheduled.
  const local = (await serverHoldsToken(db)) ? null : child.reminderTime;
  await scheduleReminder(db, local, localReminder(child.tz), now);
}

/**
 * Registers this parent's phone for push, on every open: a token rots, and the language the phone
 * reads can change between opens, so the server is told both again rather than asked to remember.
 * A parent who says no to notifications, a build with no push credentials and a phone with no
 * network all end here quietly — nothing the parent is looking at depends on it.
 */
export async function registerParentPush(
  register: (input: ParentDeviceInput) => Promise<unknown>,
): Promise<void> {
  try {
    if (!(await permitted())) return;
    const projectId = Constants.expoConfig?.extra?.eas?.projectId as string | undefined;
    if (!projectId) return;
    const { data } = await Notifications.getExpoPushTokenAsync({ projectId });
    await register({
      expo_push_token: data,
      platform: Platform.OS === 'ios' ? 'ios' : 'android',
      locale,
    });
  } catch (e) {
    // The parent sees their household, not this: a digest that does not arrive is not something
    // they can act on from the screen they are on. The device still says why, because a refused
    // registration and a phone that was merely offline look identical from the outside. Only the
    // error goes to the console, never the token.
    console.error('parent push registration failed', e);
  }
}

/**
 * Reports every notification this device opens, and only that one was opened: the kind is taken
 * off the payload as an allowlist, so the ids travelling beside it so a tap can land on the right
 * screen never reach analytics (ADR-0009). One kind-agnostic event answers the open-rate question
 * for all four kinds (docs/spec/01-product.md), so a milestone that adds a notification adds
 * nothing here.
 *
 * Mounted once, at the root — a tap arrives whatever screen is up, and on a cold start it arrives
 * before either mode has a client, which is what `capturePushOpened` covers. The subscription is
 * returned rather than left running: a second listener would count every tap twice.
 */
export function watchOpenedNotifications(): () => void {
  const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
    const kind = openedNotificationKind(response.notification.request.content.data);
    if (kind) capturePushOpened(kind);
  });
  return () => subscription.remove();
}
