import {
  kidReminderCopy,
  localTimeFor,
  openedNotificationDestination,
  openedNotificationKind,
  type NotificationPath,
  type ParentDeviceInput,
} from '@chores/shared';
import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { useRouter } from 'expo-router';
import { useEffect } from 'react';
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
      // The same payload the server's push carries (#57), because this is the same notification:
      // a child whose token the server does not hold gets nudged by this one instead, and their
      // tap has to report the same kind and land in the same place as everyone else's.
      content: {
        ...kidReminderCopy(locale),
        data: { kind: 'kid_reminder', path: '/(kid)' satisfies NotificationPath },
      },
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

/**
 * Takes a tapped notification to the thing it was about (#51, and story 34 of #37): the parent's
 * day with the request that is waiting named, the child's shop for the reward that was approved,
 * the child's own list for the reminder that there is still something on it (#57).
 *
 * Separate from `watchOpenedNotifications` on purpose. That one reports the kind and may learn
 * nothing else — its allowlist is what keeps the ids beside the kind out of PostHog (ADR-0009) —
 * and this one needs those ids. Two readers of one payload, each taking only what it is allowed.
 *
 * `useLastNotificationResponse` rather than a listener, because a tap is usually what launched
 * the app: on a cold start the response is already waiting before anything mounts, which a
 * response listener added afterwards would miss entirely. It covers the warm tap too, so there is
 * one path and not two.
 *
 * Called from inside each role's group, not from the root layout: the root renders `/` first,
 * whose redirect to the role's home lands after a root effect would have navigated and would
 * carry the tap straight back off its destination. By the time a role's gate is mounted that
 * redirect has already happened. Each group takes only its own audience, so a payload for the
 * other side of the app routes nowhere.
 */
export function useNotificationTapRouting(audience: 'parent' | 'kid'): void {
  const router = useRouter();
  const response = Notifications.useLastNotificationResponse();
  useEffect(() => {
    if (!response) return;
    const destination = openedNotificationDestination(response.notification.request.content.data);
    if (!destination || destination.audience !== audience) return;
    // Handled, and cleared so it is handled once: the response outlives the screen it opened,
    // and a gate that remounts later — a parent signing out and back in — would otherwise be
    // carried off to a request they dealt with hours ago. Only this reader is cleared; the
    // analytics listener above counted the tap when it arrived.
    Notifications.clearLastNotificationResponse();
    // A switch over the allowlist, so what is navigated to is one of this file's own literals.
    // Nothing off the payload is interpolated into a route: the only thing that crosses is a
    // uuid the destination already validated, as a parameter. Routing writes nothing (#51).
    switch (destination.path) {
      case '/(parent)':
        router.navigate({ pathname: '/(parent)', params: destination.params });
        return;
      case '/(kid)':
        router.navigate('/(kid)');
        return;
      case '/(kid)/shop':
        router.navigate('/(kid)/shop');
        return;
    }
  }, [audience, response, router]);
}
