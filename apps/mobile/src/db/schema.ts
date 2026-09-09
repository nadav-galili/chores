import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';
import type { ChoreClocks, RejectReason } from '@chores/shared';

/**
 * The kid-scoped subset of the server's data model (docs/spec/03-sync.md, device scope), with the
 * same column names so a change-log row upserts as-is. Timestamps are ISO strings, dates are
 * `YYYY-MM-DD` chore dates, ids are the server's (deterministic where the spec says so).
 */

const json = <T>(name: string) => text(name, { mode: 'json' }).$type<T>();
const bool = (name: string) => integer(name, { mode: 'boolean' });

/** This device's one child; never anyone else's row. */
export const children = sqliteTable('children', {
  id: text('id').primaryKey(),
  household_id: text('household_id').notNull(),
  first_name: text('first_name').notNull(),
  ui_mode: text('ui_mode', { enum: ['little', 'big'] }).notNull(),
  pet_name: text('pet_name').notNull(),
  reminder_time: text('reminder_time'),
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

export const rewards = sqliteTable('rewards', {
  id: text('id').primaryKey(),
  household_id: text('household_id'),
  title: text('title').notNull(),
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
  type: text('type', { enum: ['complete', 'uncomplete'] }).notNull(),
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
