import { z } from 'zod';
import { addDays, type IsoDate } from './chore-date.ts';
import { rejectReasonSchema } from './ops.ts';

/** A kid device holds its instances for today ±14 days (docs/spec/03-sync.md, device scope). */
export const INSTANCE_WINDOW_DAYS = 14;

export function instanceWindow(today: IsoDate): { from: IsoDate; to: IsoDate } {
  return { from: addDays(today, -INSTANCE_WINDOW_DAYS), to: addDays(today, INSTANCE_WINDOW_DAYS) };
}

/** An intent recorded on a device and replayed to the server exactly once. */
export const syncOpSchema = z.object({
  op_id: z.string().uuid(),
  type: z.string().min(1),
  payload: z.unknown(),
});
export type SyncOp = z.infer<typeof syncOpSchema>;

/** `POST /sync`: drain the outbox and pull the change log since `cursor` (ADR-0008). */
export const syncRequestSchema = z.object({
  device_id: z.string().uuid(),
  /** The last change-log `seq` this device applied; 0 before the first pull. */
  cursor: z.number().int().min(0),
  ops: z.array(syncOpSchema),
});
export type SyncRequest = z.infer<typeof syncRequestSchema>;

export const syncChangeSchema = z.object({
  seq: z.number().int().positive(),
  table: z.string().min(1),
  row_id: z.string().uuid(),
  op: z.enum(['insert', 'update', 'delete']),
  /** The row as the server holds it, snake_case column names; the device upserts it whole. */
  row: z.record(z.unknown()),
});
export type SyncChange = z.infer<typeof syncChangeSchema>;

export const syncResponseSchema = z.object({
  acked: z.array(
    z.object({
      op_id: z.string().uuid(),
      /** The server wrote a different chore_date than the op claimed; the device drops its own. */
      date_adjusted: z.boolean().optional(),
    }),
  ),
  rejected: z.array(z.object({ op_id: z.string().uuid(), reason: rejectReasonSchema })),
  changes: z.array(syncChangeSchema),
  /** Persist this; send it back on the next pull. */
  cursor: z.number().int().min(0),
  /** More changes are waiting beyond `cursor`: pull again right away. */
  has_more: z.boolean(),
});
export type SyncResponse = z.infer<typeof syncResponseSchema>;
