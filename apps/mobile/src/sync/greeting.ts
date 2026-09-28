import { eq } from 'drizzle-orm';
import { greetingState } from '@/db/schema';
import type { DeviceDb } from '@/db/types';
import type { TodayItem } from './engine';

/**
 * The pet’s one-time greeting on a Kid Device’s first open (#86, kid first open). Once
 * the child taps it away it never shows on this device again — not after a restart, a sync or the
 * next Chore Date — so "seen" is a row in this device's own store, never on the change log.
 */

const STATE_ROW = 1;

/** What the greeting points at: the first row still due, or nothing when none is. */
export type Greeting = { pointAt: string | null };

/** The greeting to show over today's list, or null once this device has shown it. */
export async function greetingFor(db: DeviceDb, items: TodayItem[]): Promise<Greeting | null> {
  const [seen] = await db.select().from(greetingState).where(eq(greetingState.id, STATE_ROW));
  if (seen) return null;
  return { pointAt: items.find((i) => i.status === 'due')?.id ?? null };
}

export async function markGreetingSeen(db: DeviceDb, now: Date): Promise<void> {
  await db
    .insert(greetingState)
    .values({ id: STATE_ROW, seen_at: now.toISOString() })
    .onConflictDoNothing();
}
