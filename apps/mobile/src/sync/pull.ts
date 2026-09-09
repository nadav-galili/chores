import type { SyncRequest, SyncResponse } from '@chores/shared';
import type { DeviceDb } from '@/db/types';
import { applyPull, readCursor } from './engine';

export type SyncCall = (body: SyncRequest) => Promise<SyncResponse>;

let inFlight: Promise<void> | null = null;

/**
 * Pulls every waiting change-log page and applies each one atomically, persisting the cursor as
 * it goes. Concurrent callers (open + foreground) share one run; the outbox joins this in a later
 * ticket. Errors propagate: the caller decides what a revoked device or a dead network means.
 */
export function pull(db: DeviceDb, deviceId: string, sync: SyncCall): Promise<void> {
  inFlight ??= (async () => {
    try {
      for (;;) {
        const cursor = await readCursor(db);
        const response = await sync({ device_id: deviceId, cursor, ops: [] });
        await applyPull(db, response);
        if (!response.has_more) return;
      }
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}
