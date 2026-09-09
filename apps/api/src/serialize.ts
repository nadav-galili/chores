import type {
  Child,
  Chore,
  ChoreFields,
  Household,
  ChildSummary,
  HouseholdSummary,
  Parent,
} from '@chores/shared';
import type { children, chores, households, parents } from './db/schema.ts';

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

/** The parent-editable fields of a chore row, plus its assignee set. */
export function choreFieldsFromRow(
  row: typeof chores.$inferSelect,
  assignees: string[],
): ChoreFields {
  return {
    title: row.title,
    icon: row.icon,
    kind: row.kind,
    weekday_mask: row.weekdayMask,
    start_date: row.startDate,
    end_date: row.endDate,
    due_date: row.dueDate,
    requires_photo: row.requiresPhoto,
    assignees,
  };
}

export function choreToApi(row: typeof chores.$inferSelect, assignees: string[]): Chore {
  return {
    id: row.id,
    household_id: row.householdId,
    ...choreFieldsFromRow(row, assignees),
    version: row.version,
    updated_at: row.updatedAt.toISOString(),
    updated_by: row.updatedBy,
    deleted_at: iso(row.deletedAt),
  };
}

/** First name only: the kid device never learns anything else about the child. */
export function childSummaryToApi(row: typeof children.$inferSelect): ChildSummary {
  return { id: row.id, first_name: row.firstName, ui_mode: row.uiMode, pet_name: row.petName };
}

export function householdSummaryToApi(row: typeof households.$inferSelect): HouseholdSummary {
  return { id: row.id, tz: row.tz, day_boundary_hour: row.dayBoundaryHour };
}
