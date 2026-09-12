import type {
  Child,
  ParentInvite,
  Chore,
  ChoreFields,
  Household,
  ChildSummary,
  HouseholdSummary,
  Parent,
  Reward,
  ParentDevice,
  ChildDevice,
} from '@chores/shared';
import type {
  childDevices,
  children,
  chores,
  households,
  parentDevices,
  parentInvites,
  parents,
  rewards,
} from './db/schema.ts';

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
    email: row.email,
    display_name: row.displayName,
    created_at: row.createdAt.toISOString(),
  };
}

export function parentInviteToApi(row: typeof parentInvites.$inferSelect): ParentInvite {
  return {
    email: row.email,
    household_id: row.householdId,
    invited_by: row.invitedBy,
    created_at: row.createdAt.toISOString(),
    accepted_at: iso(row.acceptedAt),
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

/** The registration read back. The push token stays on the server; the phone already has it. */
export function parentDeviceToApi(row: typeof parentDevices.$inferSelect): ParentDevice {
  return {
    id: row.id,
    parent_id: row.parentId,
    platform: row.platform,
    locale: row.locale,
    last_seen_at: row.lastSeenAt.toISOString(),
  };
}

/**
 * A Kid Device as its parent sees it. Four fields and no fifth: the token hash, the push token
 * and the analytics anon id stay on the server — the first two are credentials and the third is
 * the child's analytics identity (ADR-0009). `revoked_at` is carried rather than filtered on,
 * because a revoked device is shown as revoked.
 */
export function childDeviceToApi(row: typeof childDevices.$inferSelect): ChildDevice {
  return {
    id: row.id,
    platform: row.platform,
    last_seen_at: row.lastSeenAt.toISOString(),
    revoked_at: iso(row.revokedAt),
  };
}

/** The Parent PIN crosses to the kid device on purpose, and only here (ADR-0013). */
export function householdSummaryToApi(row: typeof households.$inferSelect): HouseholdSummary {
  return {
    id: row.id,
    tz: row.tz,
    day_boundary_hour: row.dayBoundaryHour,
    pin_hash: row.pinHash,
    pin_salt: row.pinSalt,
  };
}

/** A reward row on the wire. `title` stays null for a built-in; the reader's i18n names it. */
export function rewardToApi(row: typeof rewards.$inferSelect): Reward {
  return {
    id: row.id,
    household_id: row.householdId,
    builtin_key: row.builtinKey,
    title: row.title,
    icon: row.icon,
    cost_coins: row.costCoins,
    is_builtin: row.isBuiltin,
    active: row.active,
    sort: row.sort,
    updated_at: row.updatedAt.toISOString(),
    deleted_at: iso(row.deletedAt),
  };
}
