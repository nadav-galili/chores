import {
  bigserial,
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import type { ChoreClocks } from '@chores/shared';

export const currencyEnum = pgEnum('currency', ['ILS', 'USD']);
export const entitlementEnum = pgEnum('entitlement', ['free', 'premium']);
export const uiModeEnum = pgEnum('ui_mode', ['little', 'big']);
export const platformEnum = pgEnum('platform', ['ios', 'android']);
export const choreKindEnum = pgEnum('chore_kind', ['once', 'daily', 'weekdays']);
export const instanceStatusEnum = pgEnum('instance_status', [
  'due',
  'done',
  'pending_photo',
  'redo',
]);

const timestamptz = (name: string) => timestamp(name, { withTimezone: true });

export const households = pgTable('households', {
  id: uuid('id').primaryKey(),
  name: text('name').notNull(),
  tz: text('tz').notNull(),
  dayBoundaryHour: smallint('day_boundary_hour').notNull().default(0),
  digestHour: smallint('digest_hour').notNull().default(20),
  currency: currencyEnum('currency').notNull(),
  coinsPerUnit: integer('coins_per_unit').notNull().default(10),
  entitlement: entitlementEnum('entitlement').notNull().default('free'),
  entitlementSource: text('entitlement_source'),
  createdAt: timestamptz('created_at').notNull().defaultNow(),
});

export const parents = pgTable('parents', {
  id: uuid('id').primaryKey(),
  householdId: uuid('household_id')
    .notNull()
    .references(() => households.id),
  clerkUserId: text('clerk_user_id').notNull().unique(),
  displayName: text('display_name'),
  pinHash: text('pin_hash'),
  createdAt: timestamptz('created_at').notNull().defaultNow(),
});

export const parentDevices = pgTable('parent_devices', {
  id: uuid('id').primaryKey(),
  parentId: uuid('parent_id')
    .notNull()
    .references(() => parents.id),
  expoPushToken: text('expo_push_token'),
  platform: platformEnum('platform').notNull(),
  lastSeenAt: timestamptz('last_seen_at').notNull().defaultNow(),
});

export const children = pgTable('children', {
  id: uuid('id').primaryKey(),
  householdId: uuid('household_id')
    .notNull()
    .references(() => households.id),
  firstName: text('first_name').notNull(),
  uiMode: uiModeEnum('ui_mode').notNull(),
  petName: text('pet_name').notNull(),
  /** Household-local wall-clock `HH:MM`; null means no reminder. */
  reminderTime: text('reminder_time'),
  readOnlyAfter: timestamptz('read_only_after'),
  sort: integer('sort').notNull().default(0),
  createdAt: timestamptz('created_at').notNull().defaultNow(),
});

export const childDevices = pgTable('child_devices', {
  id: uuid('id').primaryKey(),
  childId: uuid('child_id')
    .notNull()
    .references(() => children.id),
  householdId: uuid('household_id')
    .notNull()
    .references(() => households.id),
  tokenHash: text('token_hash').notNull().unique(),
  analyticsAnonId: text('analytics_anon_id').notNull(),
  expoPushToken: text('expo_push_token'),
  platform: platformEnum('platform').notNull(),
  lastSeenAt: timestamptz('last_seen_at').notNull().defaultNow(),
  revokedAt: timestamptz('revoked_at'),
});

export const joinCodes = pgTable('join_codes', {
  code: text('code').primaryKey(),
  householdId: uuid('household_id')
    .notNull()
    .references(() => households.id),
  childId: uuid('child_id')
    .notNull()
    .references(() => children.id),
  createdBy: uuid('created_by')
    .notNull()
    .references(() => parents.id),
  expiresAt: timestamptz('expires_at').notNull(),
  redeemedAt: timestamptz('redeemed_at'),
  redeemedDeviceId: uuid('redeemed_device_id').references(() => childDevices.id),
});

const localDate = (name: string) => date(name, { mode: 'string' });

export const chores = pgTable('chores', {
  id: uuid('id').primaryKey(),
  householdId: uuid('household_id')
    .notNull()
    .references(() => households.id),
  title: text('title').notNull(),
  icon: text('icon'),
  kind: choreKindEnum('kind').notNull(),
  /** Bit mask, Mon=0 … Sun=6; only read for `weekdays`. */
  weekdayMask: smallint('weekday_mask'),
  startDate: localDate('start_date'),
  endDate: localDate('end_date'),
  dueDate: localDate('due_date'),
  requiresPhoto: boolean('requires_photo').notNull().default(false),
  version: integer('version').notNull().default(1),
  /** The latest writer clock that landed on any field. */
  updatedAt: timestamptz('updated_at').notNull(),
  updatedBy: uuid('updated_by')
    .notNull()
    .references(() => parents.id),
  deletedAt: timestamptz('deleted_at'),
  /** Writer clock per field, for last-writer-wins merges (docs/spec/03-sync.md). */
  fieldClocks: jsonb('field_clocks').$type<ChoreClocks>().notNull().default({}),
});

export const choreAssignees = pgTable(
  'chore_assignees',
  {
    choreId: uuid('chore_id')
      .notNull()
      .references(() => chores.id),
    childId: uuid('child_id')
      .notNull()
      .references(() => children.id),
  },
  (t) => [primaryKey({ columns: [t.choreId, t.childId] })],
);

/**
 * One occurrence of a chore for one child on one chore date; id = uuid5(chore, child, date).
 * Materialized by the device on day open, by the server cron at the household boundary and
 * lazily by the server on a kid pull; `ON CONFLICT DO NOTHING` makes the race harmless (ADR-0003).
 */
export const choreInstances = pgTable(
  'chore_instances',
  {
    id: uuid('id').primaryKey(),
    choreId: uuid('chore_id')
      .notNull()
      .references(() => chores.id),
    childId: uuid('child_id')
      .notNull()
      .references(() => children.id),
    householdId: uuid('household_id')
      .notNull()
      .references(() => households.id),
    choreDate: localDate('chore_date').notNull(),
    status: instanceStatusEnum('status').notNull().default('due'),
  },
  (t) => [
    uniqueIndex('chore_instances_chore_child_date').on(t.choreId, t.childId, t.choreDate),
    index('chore_instances_child_date').on(t.childId, t.choreDate),
  ],
);

/** Written by the `log_change` trigger (see the migration); never by application code. */
export const changeLog = pgTable('change_log', {
  seq: bigserial('seq', { mode: 'number' }).primaryKey(),
  householdId: uuid('household_id').notNull(),
  childId: uuid('child_id'),
  table: text('table').notNull(),
  rowId: uuid('row_id').notNull(),
  op: text('op').notNull(),
  row: jsonb('row').notNull(),
  at: timestamptz('at').notNull().defaultNow(),
});

export const completionStatusEnum = pgEnum('completion_status', [
  'accepted',
  'pending_photo',
  'rejected',
  'undone',
]);
export const ledgerKindEnum = pgEnum('ledger_kind', [
  'earn',
  'bonus',
  'streak',
  'clawback',
  'redeem',
  'payout',
  'adjust',
]);
export const ledgerRefTypeEnum = pgEnum('ledger_ref_type', [
  'completion',
  'chore_date',
  'ledger_entry',
]);

/**
 * A child marking an instance done. Append-only: the row is written once and afterwards only its
 * status moves (a parent's rejection, the child's own same-day undo). Completion of a deleted
 * chore is accepted and paid (docs/spec/03-sync.md, conflict rules).
 */
export const completions = pgTable(
  'completions',
  {
    id: uuid('id').primaryKey(),
    instanceId: uuid('instance_id').notNull(),
    choreId: uuid('chore_id')
      .notNull()
      .references(() => chores.id),
    childId: uuid('child_id')
      .notNull()
      .references(() => children.id),
    householdId: uuid('household_id')
      .notNull()
      .references(() => households.id),
    choreDate: localDate('chore_date').notNull(),
    completedAt: timestamptz('completed_at').notNull(),
    deviceId: uuid('device_id'),
    photoKey: text('photo_key'),
    status: completionStatusEnum('status').notNull(),
    rejectedBy: uuid('rejected_by').references(() => parents.id),
    rejectedAt: timestamptz('rejected_at'),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (t) => [index('completions_child_date').on(t.childId, t.choreDate)],
);

/** Append-only and signed; a child's balance is always `SUM(coins)` (ADR-0002). */
export const ledgerEntries = pgTable(
  'ledger_entries',
  {
    id: uuid('id').primaryKey(),
    householdId: uuid('household_id')
      .notNull()
      .references(() => households.id),
    childId: uuid('child_id')
      .notNull()
      .references(() => children.id),
    kind: ledgerKindEnum('kind').notNull(),
    coins: integer('coins').notNull(),
    /** Minor units of the household currency; only payouts carry one. */
    moneyAmount: integer('money_amount'),
    refType: ledgerRefTypeEnum('ref_type'),
    refId: text('ref_id'),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
    createdBy: text('created_by'),
  },
  (t) => [index('ledger_entries_child').on(t.childId)],
);

/** Mirrors every earn/bonus/streak/clawback 1:1; pet level is a threshold over `SUM(xp)`. */
export const xpEvents = pgTable(
  'xp_events',
  {
    id: uuid('id').primaryKey(),
    childId: uuid('child_id')
      .notNull()
      .references(() => children.id),
    xp: integer('xp').notNull(),
    refEntryId: uuid('ref_entry_id')
      .notNull()
      .references(() => ledgerEntries.id),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (t) => [index('xp_events_child').on(t.childId)],
);

/** Recomputed on every completion and rejection; the only row here that is ever updated. */
export const daySummaries = pgTable(
  'day_summaries',
  {
    childId: uuid('child_id')
      .notNull()
      .references(() => children.id),
    choreDate: localDate('chore_date').notNull(),
    dueCount: integer('due_count').notNull(),
    doneCount: integer('done_count').notNull(),
    complete: boolean('complete').notNull(),
    streakAfter: integer('streak_after').notNull(),
  },
  (t) => [primaryKey({ columns: [t.childId, t.choreDate] })],
);

/** Append-only, never clawed back: a rejection costs coins and the streak, never a tree (ADR-0011). */
export const growthEntries = pgTable(
  'growth_entries',
  {
    id: uuid('id').primaryKey(),
    householdId: uuid('household_id')
      .notNull()
      .references(() => households.id),
    childId: uuid('child_id')
      .notNull()
      .references(() => children.id),
    choreDate: localDate('chore_date').notNull(),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (t) => [index('growth_entries_child').on(t.childId)],
);

/** Every op the server has already applied, with what it answered; a replay reads this and stops. */
export const appliedOps = pgTable('applied_ops', {
  opId: uuid('op_id').primaryKey(),
  deviceId: uuid('device_id').notNull(),
  /** The `acked`/`rejected` entry to return again, verbatim. */
  result: jsonb('result').notNull(),
  at: timestamptz('at').notNull().defaultNow(),
});
