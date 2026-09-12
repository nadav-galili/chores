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

/**
 * The kind a tapped notification reports, read back off its own payload as an allowlist rather
 * than a scrub list (CODING_STANDARDS): a push also carries the ids a tap needs to land on the
 * right screen, and only the kind — one of the four constants above, naming what the push was
 * about and never who it was about — may reach analytics (ADR-0009). A payload naming no kind of
 * ours, from an older or newer build, reports nothing.
 */
export function openedNotificationKind(data: unknown): NotificationKind | null {
  const kind = (data as { kind?: unknown } | null | undefined)?.kind;
  const parsed = notificationKindSchema.safeParse(kind);
  return parsed.success ? parsed.data : null;
}

/**
 * Where a tap may land, and nowhere else. The server writes one of these into a push's `path`
 * and the device reads it back — one list, so the two cannot drift into a route that does not
 * exist. A payload is untrusted input from outside the app, so the path is matched against this
 * allowlist and the matched constant is what is navigated to; nothing off a payload is ever
 * interpolated into a route.
 */
export const NOTIFICATION_PATHS = ['/(parent)', '/(kid)/shop'] as const;
export type NotificationPath = (typeof NOTIFICATION_PATHS)[number];
const notificationPathSchema = z.enum(NOTIFICATION_PATHS);

/** Which side of the app a path belongs to: a device is one role, and only routes to its own. */
const PATH_AUDIENCE: Readonly<Record<NotificationPath, 'parent' | 'kid'>> = {
  '/(parent)': 'parent',
  '/(kid)/shop': 'kid',
};

export type NotificationDestination = {
  path: NotificationPath;
  audience: 'parent' | 'kid';
  /**
   * Which of the things on that screen the tap was about. Ids only, each one validated as a uuid
   * before it is passed on — a route parameter is the one place payload text could otherwise
   * reach navigation.
   */
  params: { redemption?: string };
};

/**
 * Where a tapped notification should land, read off its own payload the same way the kind is: as
 * an allowlist. A payload naming a path this build does not have — an older or a newer server —
 * routes nowhere, which is exactly what tapping did before any of this existed.
 *
 * Routing is not a write: nothing read here reaches the local database (#51). The ids it does
 * take go into the route and are resolved against what the device pulls for itself.
 */
export function openedNotificationDestination(data: unknown): NotificationDestination | null {
  const payload = (data ?? {}) as Record<string, unknown>;
  const path = notificationPathSchema.safeParse(payload.path);
  if (!path.success) return null;
  const redemption = z.string().uuid().safeParse(payload.redemption_id);
  return {
    path: path.data,
    audience: PATH_AUDIENCE[path.data],
    params: redemption.success ? { redemption: redemption.data } : {},
  };
}

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
 * to the child straight away. Neither of these two names the child or the reward: they take no
 * arguments at all, which is what keeps them nameless rather than a rule to remember. Which child
 * it was is in the push's data, as an id the app resolves after it pulls.
 *
 * This says nothing about the digest below, which does name children under the carve-out in
 * CODING_STANDARDS and ADR-0009.
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

/** One child's standing in the digest's Chore Date. Day Complete is derived, never carried. */
export type DigestChild = { first_name: string; due_count: number; done_count: number };

export type DigestSummary = {
  children: readonly DigestChild[];
  /** Redemptions nobody has decided, whatever Chore Date they were asked for. */
  undecided_redemptions: number;
};

/** Day Complete: every Instance of that Chore Date done. Derived here, as it is everywhere. */
export const isDayComplete = (child: DigestChild): boolean =>
  child.due_count > 0 && child.done_count === child.due_count;

/**
 * Whether the digest is worth a parent's evening. A day with nothing due and nothing waiting
 * sends nothing at all, so the notification keeps meaning something (docs/spec/01-product.md,
 * notifications). Asked before the claim row is written: a day that later gets a chore must not
 * stay suppressed because an earlier tick already spent its claim.
 */
export function digestWorthSending(summary: DigestSummary): boolean {
  if (summary.undecided_redemptions > 0) return true;
  return summary.children.some((child) => child.due_count > 0);
}

type DigestWords = {
  title: string;
  child: (name: string, done: number, due: number) => string;
  complete: (name: string, due: number) => string;
  nothingDue: (name: string) => string;
  waiting: (count: number) => string;
};

/**
 * The digest's words. The day is still open when this arrives, so the copy counts what is done
 * — "3/4 done" — and never says a child did not complete something they still have hours to do.
 * Server-only, but it lives beside the reminder's copy for the same reason: one place to read
 * what this app says to a family.
 */
const DIGEST_COPY: Readonly<Record<Locale, DigestWords>> = {
  en: {
    title: 'Today so far',
    child: (name, done, due) => `${name} ${done}/${due} done`,
    complete: (name, due) => `${name} ${due}/${due} done — all done`,
    nothingDue: (name) => `${name} — nothing due`,
    waiting: (count) =>
      count === 1 ? '1 reward is waiting for you' : `${count} rewards are waiting for you`,
  },
  he: {
    title: 'היום עד עכשיו',
    child: (name, done, due) => `${name} ${done}/${due} בוצעו`,
    complete: (name, due) => `${name} ${due}/${due} בוצעו — הכול בוצע`,
    nothingDue: (name) => `${name} — אין מטלות`,
    // Hebrew counts two as a word of its own; "2 פרסים" reads like a form nobody writes.
    waiting: (count) => {
      if (count === 1) return 'פרס אחד ממתין להחלטה שלך';
      if (count === 2) return 'שני פרסים ממתינים להחלטה שלך';
      return `${count} פרסים ממתינים להחלטה שלך`;
    },
  },
};

/**
 * The digest as one parent reads it, in the locale their device registered. Lines rather than a
 * run-on sentence, so a household with three children is still scannable on a lock screen.
 *
 * This is the one place child data crosses to a third party, and it is a carve-out written down
 * rather than an oversight: the digest says who is done and who is not, so a first name is what
 * makes it readable at all, and a lock screen naming nobody is useless to a parent of three. The
 * carve-out is exactly this — first names only, in copy addressed to a registered device of a
 * parent of that child's own household — and it is stated in CODING_STANDARDS (Child privacy)
 * and ADR-0009. It widens nothing about analytics: a child is still anonymous there.
 */
export function digestCopy(
  locale: Locale,
  summary: DigestSummary,
): { title: string; body: string } {
  const words = DIGEST_COPY[locale];
  const lines = summary.children.map((child) => {
    if (child.due_count === 0) return words.nothingDue(child.first_name);
    if (isDayComplete(child)) return words.complete(child.first_name, child.due_count);
    return words.child(child.first_name, child.done_count, child.due_count);
  });
  // Zero is not news; a waiting request is.
  if (summary.undecided_redemptions > 0) lines.push(words.waiting(summary.undecided_redemptions));
  return { title: words.title, body: lines.join('\n') };
}
