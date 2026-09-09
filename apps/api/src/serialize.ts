import type { Child, Household, Parent } from '@chores/shared';
import type { children, households, parents } from './db/schema.ts';

const iso = (d: Date | null) => (d ? d.toISOString() : null);

export function householdToApi(row: typeof households.$inferSelect): Household {
  return {
    id: row.id,
    name: row.name,
    tz: row.tz,
    day_boundary_hour: row.dayBoundaryHour,
    digest_hour: row.digestHour,
    currency: row.currency,
    coins_per_unit: row.coinsPerUnit,
    entitlement: row.entitlement,
    entitlement_source: row.entitlementSource,
    created_at: row.createdAt.toISOString(),
  };
}

export function parentToApi(row: typeof parents.$inferSelect): Parent {
  return {
    id: row.id,
    household_id: row.householdId,
    clerk_user_id: row.clerkUserId,
    display_name: row.displayName,
    created_at: row.createdAt.toISOString(),
  };
}

export function childToApi(row: typeof children.$inferSelect): Child {
  return {
    id: row.id,
    household_id: row.householdId,
    first_name: row.firstName,
    ui_mode: row.uiMode,
    pet_name: row.petName,
    reminder_time: row.reminderTime,
    read_only_after: iso(row.readOnlyAfter),
    sort: row.sort,
    created_at: row.createdAt.toISOString(),
  };
}
