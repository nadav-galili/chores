import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';
import type { BuiltinRewardKey, Locale } from '@chores/shared';
import type { ChoreClocks, RejectReason } from '@chores/shared';

/**
 * The kid-scoped subset of the server's data model (docs/spec/03-sync.md, device scope), with the
 * same column names so a change-log row upserts as-is. Timestamps are ISO strings, dates are
 * `YYYY-MM-DD` chore dates, ids are the server's (deterministic where the spec says so).
 */

const json = <T>(name: string) => text(name, { mode: 'json' }).$type<T>();
const bool = (name: string) => integer(name, { mode: 'boolean' });

/**
 * The household's children: this device's own child, and its siblings for the grove's sake — one
 * of the two tables that reach a kid device household-wide (docs/spec/03-sync.md). Every query
 * about *this* child still filters by id; only the grove reads them all.
 */
export const children = sqliteTable('children', {
  id: text('id').primaryKey(),
  household_id: text('household_id').notNull(),
  first_name: text('first_name').notNull(),
  ui_mode: text('ui_mode', { enum: ['little', 'big'] }).notNull(),
  pet_name: text('pet_name').notNull(),
  reminder_time: text('reminder_time'),
  /** Display-only quota metadata mirror. Kid-device behavior never consults it (ADR-0005). */
  read_only_after: text('read_only_after'),
  sort: integer('sort').notNull().default(0),
  created_at: text('created_at').notNull(),
});

export const chores = sqliteTable('chores', {
  id: text('id').primaryKey(),
  household_id: text('household_id').notNull(),
  title: text('title').notNull(),
  icon: text('icon'),
  kind: text('kind', { enum: ['once', 'daily', 'weekdays'] }).notNull(),
  weekday_mask: integer('weekday_mask'),
  start_date: text('start_date'),
  end_date: text('end_date'),
  due_date: text('due_date'),
  requires_photo: bool('requires_photo').notNull().default(false),
  version: integer('version').notNull().default(1),
  updated_at: text('updated_at').notNull(),
  updated_by: text('updated_by').notNull(),
  deleted_at: text('deleted_at'),
  field_clocks: json<ChoreClocks>('field_clocks').notNull().default({}),
});

export const choreAssignees = sqliteTable(
  'chore_assignees',
  {
    chore_id: text('chore_id').notNull(),
    child_id: text('child_id').notNull(),
  },
  (t) => [primaryKey({ columns: [t.chore_id, t.child_id] })],
);

export const choreInstances = sqliteTable(
  'chore_instances',
  {
    id: text('id').primaryKey(),
    chore_id: text('chore_id').notNull(),
    child_id: text('child_id').notNull(),
    household_id: text('household_id').notNull(),
    chore_date: text('chore_date').notNull(),
    status: text('status', { enum: ['due', 'done', 'pending_photo', 'redo'] })
      .notNull()
      .default('due'),
  },
  (t) => [
    uniqueIndex('chore_instances_chore_child_date').on(t.chore_id, t.child_id, t.chore_date),
    index('chore_instances_child_date').on(t.child_id, t.chore_date),
  ],
);

export const completions = sqliteTable('completions', {
  id: text('id').primaryKey(),
  instance_id: text('instance_id').notNull(),
  chore_id: text('chore_id').notNull(),
  child_id: text('child_id').notNull(),
  household_id: text('household_id').notNull(),
  chore_date: text('chore_date').notNull(),
  completed_at: text('completed_at').notNull(),
  device_id: text('device_id'),
  photo_key: text('photo_key'),
  status: text('status', {
    enum: ['accepted', 'pending_photo', 'rejected', 'undone'],
  }).notNull(),
  rejected_by: text('rejected_by'),
  rejected_at: text('rejected_at'),
  created_at: text('created_at').notNull(),
});

export const ledgerEntries = sqliteTable('ledger_entries', {
  id: text('id').primaryKey(),
  household_id: text('household_id').notNull(),
  child_id: text('child_id').notNull(),
  kind: text('kind').notNull(),
  coins: integer('coins').notNull(),
  money_amount: integer('money_amount'),
  ref_type: text('ref_type'),
  ref_id: text('ref_id'),
  created_at: text('created_at').notNull(),
  created_by: text('created_by'),
});

export const xpEvents = sqliteTable('xp_events', {
  id: text('id').primaryKey(),
  child_id: text('child_id').notNull(),
  xp: integer('xp').notNull(),
  ref_entry_id: text('ref_entry_id').notNull(),
  created_at: text('created_at').notNull(),
});

export const daySummaries = sqliteTable(
  'day_summaries',
  {
    child_id: text('child_id').notNull(),
    chore_date: text('chore_date').notNull(),
    due_count: integer('due_count').notNull(),
    done_count: integer('done_count').notNull(),
    complete: bool('complete').notNull(),
    streak_after: integer('streak_after').notNull(),
  },
  (t) => [primaryKey({ columns: [t.child_id, t.chore_date] })],
);

export const growthEntries = sqliteTable('growth_entries', {
  id: text('id').primaryKey(),
  household_id: text('household_id').notNull(),
  child_id: text('child_id').notNull(),
  chore_date: text('chore_date').notNull(),
  created_at: text('created_at').notNull(),
});

/**
 * The household's reward catalog, copied in when the household was created — built-ins included,
 * which is why `household_id` is not nullable (docs/spec/02-data-model.md). A built-in carries a
 * `builtin_key` and no `title`: the shop renders its name from i18n, so the same row reads in
 * whatever language this device is set to.
 */
export const rewards = sqliteTable('rewards', {
  id: text('id').primaryKey(),
  household_id: text('household_id').notNull(),
  builtin_key: text('builtin_key').$type<BuiltinRewardKey>(),
  title: text('title'),
  icon: text('icon'),
  cost_coins: integer('cost_coins').notNull(),
  is_builtin: bool('is_builtin').notNull().default(false),
  active: bool('active').notNull().default(true),
  sort: integer('sort').notNull().default(0),
  updated_at: text('updated_at').notNull(),
  deleted_at: text('deleted_at'),
});

export const redemptions = sqliteTable('redemptions', {
  id: text('id').primaryKey(),
  reward_id: text('reward_id').notNull(),
  child_id: text('child_id').notNull(),
  household_id: text('household_id').notNull(),
  cost_coins: integer('cost_coins').notNull(),
  status: text('status', { enum: ['requested', 'approved', 'declined', 'cancelled'] }).notNull(),
  requested_at: text('requested_at').notNull(),
  decided_at: text('decided_at'),
  decided_by: text('decided_by'),
});

/**
 * Ops written locally and not yet acknowledged (docs/spec/03-sync.md). A row leaves the queue
 * only when the server acks it; one the server refuses stays behind as `rejected` with its reason,
 * so a stuck op is visible instead of retried forever.
 */
export const outbox = sqliteTable('outbox', {
  op_id: text('op_id').primaryKey(),
  type: text('type', {
    enum: [
      'complete',
      'uncomplete',
      'register_push_token',
      'request_redemption',
      'cancel_redemption',
    ],
  }).notNull(),
  payload: json<Record<string, unknown>>('payload').notNull(),
  created_at: text('created_at').notNull(),
  attempts: integer('attempts').notNull().default(0),
  /** Nothing is sent before this instant; it moves out on every failed attempt. */
  next_attempt_at: text('next_attempt_at').notNull(),
  status: text('status', { enum: ['pending', 'rejected'] })
    .notNull()
    .default('pending'),
  /** Why the server refused it; only ever set on a `rejected` row. */
  reason: text('reason').$type<RejectReason>(),
});

/**
 * Photos waiting on an upload (M3.12, ADR-0017). One row per `pending_photo` completion whose
 * `complete` op has not been queued yet: the op is enqueued only after the bytes reach R2, so a
 * device with no network holds the photo here rather than an op the server cannot yet accept.
 * Local-only, never synced — the server learns the photo through the op's `photo_key`.
 */
export const photoUploads = sqliteTable('photo_uploads', {
  completion_id: text('completion_id').primaryKey(),
  chore_id: text('chore_id').notNull(),
  chore_date: text('chore_date').notNull(),
  completed_at: text('completed_at').notNull(),
  /** Where the bytes live on this device until the upload succeeds; replaced on a retake. */
  local_uri: text('local_uri').notNull(),
  content_type: text('content_type').notNull(),
  created_at: text('created_at').notNull(),
  attempts: integer('attempts').notNull().default(0),
  /** Nothing is uploaded before this instant; it moves out on every failed attempt. */
  next_attempt_at: text('next_attempt_at').notNull(),
});

/**
 * Feature flags, fetched in parent mode and cached here: kid mode never calls the flag service,
 * and must work offline (docs/spec/01-product.md, analytics). A flag with no row falls back to
 * its default, so a device that has never seen a parent still behaves.
 */
export const flags = sqliteTable('flags', {
  key: text('key').primaryKey(),
  enabled: bool('enabled').notNull(),
  updated_at: text('updated_at').notNull(),
});

/**
 * What the child has already been told about their pet. `shown_level` only ever rises: XP can be
 * clawed back, but a pet the child has seen at level 3 is never demoted (docs/spec/01-product.md).
 */
export const petState = sqliteTable('pet_state', {
  child_id: text('child_id').primaryKey(),
  shown_level: integer('shown_level').notNull().default(1),
});

/**
 * One row: what this device has already arranged about notifications — the push token it told the
 * server about, and the reminder time it asked the OS to fire at. Both are compared before doing
 * anything, so a token that has not rotted costs no op and a reminder that has not moved is not
 * rescheduled (docs/spec/01-product.md, notifications).
 */
export const notificationState = sqliteTable('notification_state', {
  id: integer('id').primaryKey(),
  /** The Expo push token the server has been told about; null until one is registered. */
  push_token: text('push_token'),
  /** The locale registered alongside that token, so the server pushes in the child's language. */
  locale: text('locale').$type<Locale>(),
  /** The household-local `HH:MM` the local notification is scheduled for; null for none. */
  reminder_time: text('reminder_time'),
  updated_at: text('updated_at').notNull(),
});

/**
 * One row: what this device has already reported to analytics, so a daily event is daily and a
 * growth is a growth (ADR-0009). Kept here rather than in memory because the questions are about
 * days and the app is relaunched many times a day; a restart must not look like another open.
 */
export const analyticsState = sqliteTable('analytics_state', {
  id: integer('id').primaryKey(),
  /** The last chore date this device reported an open for. */
  opened_on: text('opened_on'),
  /** The last chore date this device reported a Day Complete for. */
  completed_on: text('completed_on'),
  /**
   * The child's Grove Stage as last reported; null until this device has read one. A stage only
   * ever rises (ADR-0011), and the first stage a device reads is what it already had, not growth.
   */
  grove_stage: integer('grove_stage'),
});

/** One row: how far this device has pulled the change log. */
export const syncState = sqliteTable('sync_state', {
  id: integer('id').primaryKey(),
  cursor: integer('cursor').notNull().default(0),
});

/** Change-log table name → local table, for the sync engine's generic upsert. */
export const syncedTables = {
  children,
  chores,
  chore_assignees: choreAssignees,
  chore_instances: choreInstances,
  completions,
  ledger_entries: ledgerEntries,
  xp_events: xpEvents,
  day_summaries: daySummaries,
  growth_entries: growthEntries,
  rewards,
  redemptions,
} as const;
export type SyncedTable = keyof typeof syncedTables;
