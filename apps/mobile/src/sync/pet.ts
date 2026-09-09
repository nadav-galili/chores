import {
  displayedPetLevel,
  petMood,
  petProgress,
  type IsoDate,
  type PetMood,
  type PetProgress,
} from '@chores/shared';
import { and, eq, sql } from 'drizzle-orm';
import { children, daySummaries, flags, petState, xpEvents } from '@/db/schema';
import type { DeviceDb } from '@/db/types';

/**
 * The pet as the child's device knows it (docs/spec/01-product.md): level and mood from the shared
 * rules, over rows this device already holds. Nothing here calls the network — the pet reacts the
 * same offline as on.
 */

export const PET_ENABLED = 'pet_enabled';

/** The flags kid mode reads. Others exist upstream; only what a kid screen reads is cached here. */
export type FlagKey = typeof PET_ENABLED;

/**
 * What a flag means before a parent has cached anything. Kid mode never fetches flags, so an
 * uncached flag has to have an answer, and the answer is the shipped experience.
 */
export const FLAG_DEFAULTS: Readonly<Record<FlagKey, boolean>> = { [PET_ENABLED]: true };

export async function readFlag(db: DeviceDb, key: FlagKey): Promise<boolean> {
  const [row] = await db.select().from(flags).where(eq(flags.key, key));
  return row?.enabled ?? FLAG_DEFAULTS[key];
}

/**
 * Stores what parent mode last saw, so kid mode can read it offline. Parent mode does the
 * fetching in a later ticket; this is the cache it writes through.
 */
export async function cacheFlag(
  db: DeviceDb,
  key: FlagKey,
  enabled: boolean,
  now: Date,
): Promise<void> {
  await db
    .insert(flags)
    .values({ key, enabled, updated_at: now.toISOString() })
    .onConflictDoUpdate({
      target: flags.key,
      set: { enabled: sql`excluded.enabled`, updated_at: sql`excluded.updated_at` },
    });
}

/** Total XP, `SUM(xp)`; never a stored column, exactly like the coin balance. */
export async function xpTotalOf(db: DeviceDb, childId: string): Promise<number> {
  const [row] = await db
    .select({ xp: sql<number>`coalesce(sum(${xpEvents.xp}), 0)` })
    .from(xpEvents)
    .where(eq(xpEvents.child_id, childId));
  return row?.xp ?? 0;
}

export type PetView = {
  /** False only when a parent has cached `pet_enabled` off; the rest still reads true. */
  enabled: boolean;
  name: string;
  mood: PetMood;
  progress: PetProgress;
};

/**
 * The pet to draw for `today`.
 *
 * This is a read that writes: reaching a level and being shown it are the same event, so the
 * raised level is recorded here. The child is told once and no later clawback takes it back
 * (docs/spec/01-product.md).
 */
export async function showPet(db: DeviceDb, childId: string, today: IsoDate): Promise<PetView> {
  const [enabled, xp, childRows, summaries, shown] = await Promise.all([
    readFlag(db, PET_ENABLED),
    xpTotalOf(db, childId),
    db.select().from(children).where(eq(children.id, childId)),
    db
      .select()
      .from(daySummaries)
      .where(and(eq(daySummaries.child_id, childId), eq(daySummaries.chore_date, today))),
    db.select().from(petState).where(eq(petState.child_id, childId)),
  ]);

  const shownLevel = shown[0]?.shown_level ?? 1;
  const level = displayedPetLevel(xp, shownLevel);
  if (level > shownLevel) {
    await db
      .insert(petState)
      .values({ child_id: childId, shown_level: level })
      .onConflictDoUpdate({
        target: petState.child_id,
        set: { shown_level: sql`excluded.shown_level` },
      });
  }

  return {
    enabled,
    name: childRows[0]?.pet_name ?? 'Pet',
    mood: petMood(summaries[0]),
    progress: petProgress(xp, level),
  };
}
