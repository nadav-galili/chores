import { integer, pgEnum, pgTable, smallint, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const currencyEnum = pgEnum('currency', ['ILS', 'USD']);
export const entitlementEnum = pgEnum('entitlement', ['free', 'premium']);

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
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
