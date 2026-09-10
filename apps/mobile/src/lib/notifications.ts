import { KID_REMINDER_COPY, localTimeFor } from '@chores/shared';
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
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
    name: 'Reminders',
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
      content: KID_REMINDER_COPY,
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
      await registerPushToken(db, data, now);
    } catch {
      // Offline, or no push credentials yet: the local reminder below stays the delivery until an
      // open that reaches Expo. Nothing about the child's day depends on this.
    }
  }

  // The server pushes once it holds the token; the local notification covers every case where it
  // does not, so only one of the two is ever scheduled.
  const local = (await serverHoldsToken(db)) ? null : child.reminderTime;
  await scheduleReminder(db, local, localReminder(child.tz), now);
}
