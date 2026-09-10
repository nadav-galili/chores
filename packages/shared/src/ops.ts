import { z } from 'zod';
import { isoDateSchema } from './chore-date.ts';
import { expoPushTokenSchema } from './notification.ts';

/**
 * The ops a kid device may send (docs/spec/03-sync.md, Ops). Each is an intent recorded locally
 * and replayed until acked; `op_id` alone makes a replay a no-op, so payloads carry every id the
 * server needs rather than anything it must invent.
 */

/**
 * A tap on a chore. The child comes from the device token, never from here. `chore_date` is what
 * the device believed at tap time; the server recomputes it from `completed_at` and may override.
 */
export const completePayloadSchema = z.object({
  completion_id: z.string().uuid(),
  chore_id: z.string().uuid(),
  chore_date: isoDateSchema,
  completed_at: z.string().datetime({ offset: true }),
});
export type CompletePayload = z.infer<typeof completePayloadSchema>;

/** A second tap the same day: the completion stops counting, coins and XP are clawed back. */
export const uncompletePayloadSchema = z.object({
  completion_id: z.string().uuid(),
});
export type UncompletePayload = z.infer<typeof uncompletePayloadSchema>;

/**
 * The push token this device now holds, re-sent on every app open because a token rots. The
 * device is read from the token on the request, so nothing here says which one it belongs to.
 */
export const registerPushTokenPayloadSchema = z.object({
  expo_push_token: expoPushTokenSchema,
});
export type RegisterPushTokenPayload = z.infer<typeof registerPushTokenPayloadSchema>;

export const kidOpSchema = z.discriminatedUnion('type', [
  z.object({
    op_id: z.string().uuid(),
    type: z.literal('complete'),
    payload: completePayloadSchema,
  }),
  z.object({
    op_id: z.string().uuid(),
    type: z.literal('uncomplete'),
    payload: uncompletePayloadSchema,
  }),
  z.object({
    op_id: z.string().uuid(),
    type: z.literal('register_push_token'),
    payload: registerPushTokenPayloadSchema,
  }),
]);
export type KidOp = z.infer<typeof kidOpSchema>;
export type KidOpType = KidOp['type'];

/**
 * The op types this version knows, read off the schema. An op of any other type is a device and a
 * server that disagree about what exists, which is `unknown_op` rather than a bad payload.
 */
export const KID_OP_TYPES: readonly KidOpType[] = kidOpSchema.options.map(
  (o) => o.shape.type.value,
);

/**
 * Why an op will never be accepted. A rejected op is dropped from the outbox and surfaced;
 * anything else (network, 5xx) leaves the op queued and is retried with backoff.
 */
export const rejectReasonSchema = z.enum([
  /** The server does not know this op type; the device is newer than the server, or the reverse. */
  'unknown_op',
  /** The payload does not parse. */
  'invalid_payload',
  /** No such chore in this household. */
  'unknown_chore',
  /** No such completion, or not this child's. */
  'unknown_completion',
  /** A parent already rejected the completion; only they can undo that. */
  'already_decided',
  /** The chore date has passed: a child undoes their own tap only on the same day. */
  'too_late',
]);
export type RejectReason = z.infer<typeof rejectReasonSchema>;
