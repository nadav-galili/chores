import { groveStage } from '@chores/shared';
import { asc } from 'drizzle-orm';
import { children, growthEntries } from '@/db/schema';
import type { DeviceDb } from '@/db/types';
import { GROVE_ENABLED, readFlag } from './flags';

/**
 * The grove as the child's device knows it (ADR-0011): one tree per child, each standing at the
 * count of that child's growth entries. Every number comes from rows already on the device, so a
 * tap that completes the day grows the tree with no network.
 *
 * Nothing here remembers a stage. It does not have to: growth entries are never updated, deleted
 * or reversed, so `COUNT(*)` is already a number that only rises — which is why the stage is
 * never a stored column (CONTEXT.md, Grove Stage). A rejection that syncs in takes coins, XP and
 * the streak; the count it would have to shrink has no clawback to shrink it with.
 */

/** One child's tree in the household's grove. */
export type Tree = {
  childId: string;
  /** Null until that child's row has been pulled. Only ever null for the device's own child. */
  firstName: string | null;
  /** Grove Stage: `COUNT(*)` of that child's growth entries. */
  stage: number;
  /** This device's own child, drawn differently from their siblings'. */
  isSelf: boolean;
};

export type GroveView = {
  /** False only when a parent has cached `grove_enabled` off; the counts still read true. */
  enabled: boolean;
  /** Own tree first, then siblings in the order a parent arranged them. */
  trees: Tree[];
  /** The tree the child came to see; the one the done moment grows. */
  ownTree: Tree;
};

/** The grove to draw for `childId`. Reads local rows and nothing else. */
export async function showGrove(db: DeviceDb, childId: string): Promise<GroveView> {
  const [enabled, childRows, entries] = await Promise.all([
    readFlag(db, GROVE_ENABLED),
    db.select().from(children).orderBy(asc(children.sort), asc(children.created_at)),
    db.select().from(growthEntries),
  ]);

  // A device that has not pulled its own child row yet still has a tree to stand up.
  const rows = childRows.some((row) => row.id === childId)
    ? childRows
    : [...childRows, { id: childId, first_name: null }];

  const trees = rows
    .map((row): Tree => ({
      childId: row.id,
      firstName: row.first_name,
      stage: groveStage(entries, row.id),
      isSelf: row.id === childId,
    }))
    // The child's own tree leads: it is the one they came to see.
    .sort((a, b) => Number(b.isSelf) - Number(a.isSelf));

  return { enabled, trees, ownTree: trees[0]! };
}
