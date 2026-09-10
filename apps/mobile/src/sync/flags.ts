import { eq, sql } from 'drizzle-orm';
import { flags } from '@/db/schema';
import type { DeviceDb } from '@/db/types';

/**
 * The feature flags kid mode reads, cached locally (docs/spec/01-product.md, analytics).
 *
 * Kid mode never calls the flag service: it has to work offline, and a child is not an identity
 * the service knows (ADR-0001). Parent mode fetches and writes through to this cache; an uncached
 * flag falls back to the shipped experience.
 *
 * The pet and the grove are separate flags on purpose — they are two different bets on the
 * novelty cliff, and the milestone measures them separately (docs/spec/04-milestones.md).
 */

export const PET_ENABLED = 'pet_enabled';
export const GROVE_ENABLED = 'grove_enabled';

/** Others exist upstream; only what a kid screen reads is cached here. */
export type FlagKey = typeof PET_ENABLED | typeof GROVE_ENABLED;

/**
 * What a flag means before a parent has cached anything. Kid mode never fetches flags, so an
 * uncached flag has to have an answer, and the answer is the shipped experience.
 */
export const FLAG_DEFAULTS: Readonly<Record<FlagKey, boolean>> = {
  [PET_ENABLED]: true,
  [GROVE_ENABLED]: true,
};

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
