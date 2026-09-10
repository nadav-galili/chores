import {
  displayedPetLevel,
  petMood,
  petProgress,
  type IsoDate,
  type PetMood,
  type PetProgress,
} from '@chores/shared';
import { and, eq, sql } from 'drizzle-orm';
import { children, daySummaries, petState, xpEvents } from '@/db/schema';
import type { DeviceDb } from '@/db/types';
import { PET_ENABLED, readFlag } from './flags';

/**
 * The pet as the child's device knows it (docs/spec/01-product.md): level and mood from the shared
 * rules, over rows this device already holds. Nothing here calls the network — the pet reacts the
 * same offline as on.
 */

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
  /** Null until the child row has been pulled; the screen falls back to the joined name. */
  name: string | null;
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
    name: childRows[0]?.pet_name ?? null,
    mood: petMood(summaries[0]),
    progress: petProgress(xp, level),
  };
}
