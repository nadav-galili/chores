import { z } from 'zod';
import { isoDateSchema } from './chore-date.ts';
import { localeSchema } from './locale.ts';
import { expoPushTokenSchema } from './notification.ts';

/**
 * The ops a kid device may send (docs/spec/03-sync.md, Ops). Each is an intent recorded locally
 * and replayed until acked; `op_id` alone makes a replay a no-op, so payloads carry every id the
 * server needs rather than anything it must invent.
 */

/**
 * A tap on a chore. The child comes from the device token, never from here. `chore_date` is what
 * the device believed at tap time; the server recomputes it from `completed_at` and may override.
 * `photo_key` is the presign's answer echoed back (ADR-0017): the device never chooses a key, and
 * only a `requires_photo` chore is ever completed with one — which is what writes the completion
 * `pending_photo` instead of paying it.
 */
export const completePayloadSchema = z.object({
  completion_id: z.string().uuid(),
  chore_id: z.string().uuid(),
  chore_date: isoDateSchema,
  completed_at: z.string().datetime({ offset: true }),
  photo_key: z.string().min(1).max(512).optional(),
});
export type CompletePayload = z.infer<typeof completePayloadSchema>;

/** A second tap the same day: the completion stops counting, coins and XP are clawed back. */
export const uncompletePayloadSchema = z.object({
  completion_id: z.string().uuid(),
});
export type UncompletePayload = z.infer<typeof uncompletePayloadSchema>;

/**
 * The push token this device now holds, re-sent on every app open because a token rots, and the
 * locale it reads in, so a push arrives in the language the child's phone is set to. The device is
 * read from the token on the request, so nothing here says which one it belongs to.
 */
export const registerPushTokenPayloadSchema = z.object({
  expo_push_token: expoPushTokenSchema,
  locale: localeSchema.optional(),
});
export type RegisterPushTokenPayload = z.infer<typeof registerPushTokenPayloadSchema>;

/**
 * A child asking for a reward. The device has already written the Redemption row and the `redeem`
 * entry at `−cost` (ADR-0014), so every id the server needs to write the same rows is here; the
 * cost is not, because the price is the catalog's to state and the reward row on the server is
 * the one that says it. The child comes from the device token, as always.
 */
export const requestRedemptionPayloadSchema = z.object({
  redemption_id: z.string().uuid(),
  reward_id: z.string().uuid(),
  requested_at: z.string().datetime({ offset: true }),
});
export type RequestRedemptionPayload = z.infer<typeof requestRedemptionPayloadSchema>;

/** The child changing their mind. The refund is a clawback of the redeem entry, so nothing else
 * needs saying: a request a parent has already decided answers `already_decided` and moves no
 * coins. */
export const cancelRedemptionPayloadSchema = z.object({
  redemption_id: z.string().uuid(),
});
export type CancelRedemptionPayload = z.infer<typeof cancelRedemptionPayloadSchema>;

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
  z.object({
    op_id: z.string().uuid(),
    type: z.literal('request_redemption'),
    payload: requestRedemptionPayloadSchema,
  }),
  z.object({
    op_id: z.string().uuid(),
    type: z.literal('cancel_redemption'),
    payload: cancelRedemptionPayloadSchema,
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
  /** No such reward in this household, or one a parent has hidden or deleted. */
  'unknown_reward',
  /** No such redemption, or not this child's. */
  'unknown_redemption',
  /**
   * A parent already decided: they rejected the completion, or they approved or declined the
   * redemption the child is trying to cancel. Only they can undo either.
   */
  'already_decided',
  /**
   * The child cancelled first. The refund has been written once under the id both paths share
   * (ADR-0014), so the parent's decision moves no coins and is answered this instead.
   *
   * No kid op produces it: it is the answer the parent's decide-redemption endpoint gives, and it
   * lives here because that endpoint answers in the same vocabulary a refused op does.
   */
  'already_cancelled',
  /**
   * `SUM(coins)` no longer covers the request. Reachable without any device misbehaving: a
   * parent's Rejection can claw back coins the device has not pulled yet, so the optimistic rows
   * this refuses must be undone locally rather than merely dropped from the outbox (ADR-0014).
   */
  'insufficient_coins',
  /** The chore date has passed: a child undoes their own tap only on the same day. */
  'too_late',
]);
export type RejectReason = z.infer<typeof rejectReasonSchema>;

/**
 * The answer to `reject_completion`, the parent op behind a rejection (docs/spec/03-sync.md).
 * Two parents rejecting the same completion both get `rejected` and there is one clawback; a
 * completion the child already undid is `already_undone` and nothing moves.
 */
export type RejectCompletionResult = 'rejected' | 'already_undone';

/**
 * The answer to approving a waiting Photo Proof (#72). Two parents approving at once both read
 * `approved` and `already_accepted` respectively, and the chore is paid once. Declining is the
 * rejection path above, so it answers `RejectCompletionResult` rather than a second vocabulary.
 */
export type ApprovePhotoResult = 'approved' | 'already_accepted';

/** What a parent decides about a Redemption. Approving moves no coins; declining refunds. */
export const redemptionDecisionSchema = z.enum(['approve', 'decline']);
export type RedemptionDecision = z.infer<typeof redemptionDecisionSchema>;

export const decideRedemptionInputSchema = z.object({ decision: redemptionDecisionSchema });
export type DecideRedemptionInput = z.infer<typeof decideRedemptionInputSchema>;

/**
 * The answer to a decision. A redemption already approved or declined answers `already_decided`
 * however the second decision was meant; one the child cancelled first answers `already_cancelled`
 * and moves nothing, because the refund is already written under the id both paths share.
 */
export type DecideRedemptionResult =
  'approved' | 'declined' | 'already_decided' | 'already_cancelled';
