import { integer, pgEnum, pgTable, smallint, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const currencyEnum = pgEnum('currency', ['ILS', 'USD']);
export const entitlementEnum = pgEnum('entitlement', ['free', 'premium']);
export const uiModeEnum = pgEnum('ui_mode', ['little', 'big']);
export const platformEnum = pgEnum('platform', ['ios', 'android']);

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
