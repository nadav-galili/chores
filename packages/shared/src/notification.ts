import { z } from 'zod';
import type { Locale } from './locale.ts';
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
