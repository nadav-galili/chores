import {
  bigserial,
  bigint,
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
import {
  DEFAULT_LOCALE,
  LOCALES,
  ledgerRefTypeSchema,
  notificationKindSchema,
  notificationTargetSchema,
  redemptionStatusSchema,
  type BuiltinRewardKey,
  type ChoreClocks,
} from '@chores/shared';

export const currencyEnum = pgEnum('currency', ['ILS', 'USD']);
export const entitlementEnum = pgEnum('entitlement', ['free', 'premium']);
export const uiModeEnum = pgEnum('ui_mode', ['little', 'big']);
export const platformEnum = pgEnum('platform', ['ios', 'android']);
export const localeEnum = pgEnum('locale', LOCALES);
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
  /** The Parent PIN: `SHA-256(salt ‖ pin)` and a per-household salt. Null until a parent sets one (ADR-0013). */
  pinHash: text('pin_hash'),
  pinSalt: text('pin_salt'),
  createdAt: timestamptz('created_at').notNull().defaultNow(),
});

export const parents = pgTable(
  'parents',
  {
    id: uuid('id').primaryKey(),
    householdId: uuid('household_id')
      .notNull()
      .references(() => households.id),
    clerkUserId: text('clerk_user_id').notNull().unique(),
    /** Lower-cased; from the Clerk token. Null when the token carried no email claim. */
    email: text('email'),
    displayName: text('display_name'),
    createdAt: timestamptz('created_at').notNull().defaultNow(),
  },
  (t) => [index('parents_email').on(t.email)],
);

/**
 * Every authenticated RevenueCat delivery, exactly as received. The event id is RevenueCat's
 * retry-stable id, so inserting this row and moving the household entitlement are one idempotent
 * transaction (ADR-0016).
 */
export const revenuecatEvents = pgTable(
  'revenuecat_events',
  {
    eventId: text('id').primaryKey(),
    householdId: uuid('household_id')
      .notNull()
      .references(() => households.id),
    type: text('type').notNull(),
    eventTimestampMs: bigint('event_timestamp_ms', { mode: 'number' }).notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    receivedAt: timestamptz('received_at').notNull().defaultNow(),
  },
  (t) => [index('revenuecat_events_household').on(t.householdId)],
);

/**
 * A partner invited by email. There is no invite link and no mail: the address waits here and the
 * partner's first Clerk sign-in with it turns into a parent row of this household.
 */
export const parentInvites = pgTable('parent_invites', {
  email: text('email').primaryKey(),
  householdId: uuid('household_id')
    .notNull()
    .references(() => households.id),
  invitedBy: uuid('invited_by')
    .notNull()
    .references(() => parents.id),
  createdAt: timestamptz('created_at').notNull().defaultNow(),
  acceptedAt: timestamptz('accepted_at'),
  acceptedParentId: uuid('accepted_parent_id').references(() => parents.id),
});

export const parentDevices = pgTable('parent_devices', {
  id: uuid('id').primaryKey(),
  parentId: uuid('parent_id')
    .notNull()
    .references(() => parents.id),
  expoPushToken: text('expo_push_token'),
  /** The language this parent reads, so a digest arrives in it. Registered with the push token. */
  locale: localeEnum('locale').notNull().default(DEFAULT_LOCALE),
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
  /** The language this device reads, so a push arrives in it. Registered with the push token. */
  locale: localeEnum('locale').notNull().default(DEFAULT_LOCALE),
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
export const ledgerRefTypeEnum = pgEnum('ledger_ref_type', ledgerRefTypeSchema.options);

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
    /** First-class explanation for an adjustment; it is not a ledger reference. */
    note: text('note'),
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

export const redemptionStatusEnum = pgEnum('redemption_status', redemptionStatusSchema.options);

/**
 * What a child can ask for with coins. Every reward belongs to a household, built-ins included:
 * the catalog is copied in when the household is created, so no row has to reach a `change_log`
 * scoped by a household it does not have (docs/spec/02-data-model.md). A built-in carries a
 * `builtin_key` and no `title` — the device renders the title from i18n — and hiding one is
 * `active = false` on the household's own row, never a global edit.
 */
export const rewards = pgTable(
  'rewards',
  {
    id: uuid('id').primaryKey(),
    householdId: uuid('household_id')
      .notNull()
      .references(() => households.id),
    /** Set on a built-in only; a custom reward (M3) carries a title instead. */
    builtinKey: text('builtin_key').$type<BuiltinRewardKey>(),
    title: text('title'),
    icon: text('icon'),
    costCoins: integer('cost_coins').notNull(),
    isBuiltin: boolean('is_builtin').notNull().default(false),
    active: boolean('active').notNull().default(true),
    sort: integer('sort').notNull().default(0),
    updatedAt: timestamptz('updated_at').notNull(),
    deletedAt: timestamptz('deleted_at'),
  },
  (t) => [index('rewards_household').on(t.householdId)],
);

/**
 * A child's request to spend coins on a reward. The `redeem` entry is written when the request is
 * made, not when it is approved, so the status here records which story it was and never what the
 * balance is (ADR-0014). `cost_coins` is a snapshot: a parent re-pricing a reward later does not
 * rewrite what was already asked for.
 */
export const redemptions = pgTable(
  'redemptions',
  {
    id: uuid('id').primaryKey(),
    rewardId: uuid('reward_id')
      .notNull()
      .references(() => rewards.id),
    childId: uuid('child_id')
      .notNull()
      .references(() => children.id),
    householdId: uuid('household_id')
      .notNull()
      .references(() => households.id),
    costCoins: integer('cost_coins').notNull(),
    status: redemptionStatusEnum('status').notNull(),
    requestedAt: timestamptz('requested_at').notNull(),
    decidedAt: timestamptz('decided_at'),
    decidedBy: uuid('decided_by').references(() => parents.id),
  },
  (t) => [index('redemptions_child').on(t.childId)],
);

/** The four kinds and the two targets come from the shared schema; there is one list of each. */
export const notificationKindEnum = pgEnum('notification_kind', notificationKindSchema.options);
export const notificationTargetEnum = pgEnum(
  'notification_target',
  notificationTargetSchema.options,
);

/**
 * One notification being due, and what Expo said about it. The id is deterministic — kind, whom
 * it is about, and the day — so the minute cron inserting it is what decides the notification has
 * not been sent yet, and a restart cannot send it twice. A row with no `ticket` was never pushed:
 * the child's device had no token and its own local notification is the delivery.
 */
export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id').primaryKey(),
    target: notificationTargetEnum('target').notNull(),
    /** The device the push went to, if one was known when the notification came due. */
    targetId: uuid('target_id'),
    kind: notificationKindEnum('kind').notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default({}),
    scheduledFor: timestamptz('scheduled_for').notNull(),
    sentAt: timestamptz('sent_at'),
    /** Expo's ticket id, which a later tick trades for a receipt. */
    ticket: text('ticket'),
  },
  (t) => [index('notifications_ticket').on(t.ticket)],
);

/** Every op the server has already applied, with what it answered; a replay reads this and stops. */
export const appliedOps = pgTable('applied_ops', {
  opId: uuid('op_id').primaryKey(),
  deviceId: uuid('device_id').notNull(),
  /** The `acked`/`rejected` entry to return again, verbatim. */
  result: jsonb('result').notNull(),
  at: timestamptz('at').notNull().defaultNow(),
});
