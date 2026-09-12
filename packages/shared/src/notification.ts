import { z } from 'zod';
import { platformSchema } from './join-code.ts';
import { localeSchema, type Locale } from './locale.ts';
import { uuid5 } from './uuid5.ts';

/**
 * The four notifications this app sends, and nothing else (docs/spec/01-product.md, ADR-0009).
 * A row in `notifications` records one of them being due, and what Expo said about it.
 */
export const notificationKindSchema = z.enum([
  /** The child's own nudge at their reminder time. */
  'kid_reminder',
  /** The evening summary for a parent, at the household's digest hour. */
  'parent_digest',
  /** A child asked for a reward; the parent decides. */
  'redemption_requested',
  /** A parent approved a reward; the child is told. */
  'reward_approved',
]);
export type NotificationKind = z.infer<typeof notificationKindSchema>;

export const notificationTargetSchema = z.enum(['parent_device', 'child_device']);
export type NotificationTarget = z.infer<typeof notificationTargetSchema>;

/**
 * Notification id = `uuid5('notif', kind, subject_id, key)` (ADR-0010): the subject is who the
 * notification is about — a child, a parent — and the key is what makes it one of a series, a
 * chore date for the daily kinds. Deterministic, so the minute cron inserting it with
 * `ON CONFLICT DO NOTHING` sends it exactly once however often the tick runs.
 */
export function notificationId(kind: NotificationKind, subjectId: string, key: string): string {
  return uuid5('notif', kind, subjectId, key);
}

/** An Expo push token as Expo issues it; the only thing worth storing on a device row. */
export const expoPushTokenSchema = z
  .string()
  .regex(/^Expo(nent)?PushToken\[[^\]\s]+\]$/, 'expected an Expo push token');

/**
 * A parent device's id = `uuid5('parent_device', parent_id, expo_push_token)` (ADR-0010). The app
 * re-registers on every open, so the id has to be the same each time or one phone would become a
 * row per open; the token is what identifies the install, and the parent is what scopes it.
 */
export function parentDeviceId(parentId: string, expoPushToken: string): string {
  return uuid5('parent_device', parentId, expoPushToken);
}

/**
 * What a parent's phone registers for push: the token Expo issued it, what it runs on, and the
 * language it reads, so a digest arrives in that language rather than the household's.
 */
export const parentDeviceInputSchema = z.object({
  expo_push_token: expoPushTokenSchema,
  platform: platformSchema,
  locale: localeSchema,
});
export type ParentDeviceInput = z.infer<typeof parentDeviceInputSchema>;

/** The registration read back. The token is a credential and is not echoed. */
export const parentDeviceSchema = z.object({
  id: z.string().uuid(),
  parent_id: z.string().uuid(),
  platform: platformSchema,
  locale: localeSchema,
  last_seen_at: z.string().datetime(),
});
export type ParentDevice = z.infer<typeof parentDeviceSchema>;

/**
 * The kid reminder's words, in one place: the server sends them as a push and the device schedules
 * the same ones locally, so they must not drift apart. The device knows its own locale; the server
 * reads the one the device registered with its push token.
 */
const KID_REMINDER_COPY: Readonly<Record<Locale, { title: string; body: string }>> = {
  en: { title: 'Chore time!', body: 'Tap to see what\u2019s left today.' },
  he: { title: 'זמן מטלות!', body: 'הקישו כדי לראות מה נשאר להיום.' },
};

export function kidReminderCopy(locale: Locale): { title: string; body: string } {
  return KID_REMINDER_COPY[locale];
}

/**
 * The two immediate kinds' words. A redemption request is the one interrupt this app sends a
 * parent, because it is the only thing that leaves a child waiting on them; an approval is told
 * to the child straight away. Neither names the child or the reward: a push goes through Expo,
 * and nothing about a child crosses to a third party (ADR-0009). Which child it was is in the
 * push's data, as an id the app resolves after it pulls.
 */
const REDEMPTION_REQUESTED_COPY: Readonly<Record<Locale, { title: string; body: string }>> = {
  en: { title: 'A reward was asked for', body: 'Tap to decide.' },
  he: { title: 'ביקשו פרס', body: 'הקישו כדי להחליט.' },
};

const REWARD_APPROVED_COPY: Readonly<Record<Locale, { title: string; body: string }>> = {
  en: { title: 'Your reward is approved!', body: 'Tap to see it.' },
  he: { title: 'הפרס אושר!', body: 'הקישו כדי לראות אותו.' },
};

export function redemptionRequestedCopy(locale: Locale): { title: string; body: string } {
  return REDEMPTION_REQUESTED_COPY[locale];
}

export function rewardApprovedCopy(locale: Locale): { title: string; body: string } {
  return REWARD_APPROVED_COPY[locale];
}
