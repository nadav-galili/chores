import { Expo, type ExpoPushErrorReceipt, type ExpoPushMessage } from 'expo-server-sdk';

/**
 * The Expo push service, behind the little of it this app uses (docs/spec/01-product.md,
 * notifications). The cron talks to this type, so a test can answer for Expo without a network.
 */

/** Why a push failed. `DeviceNotRegistered` is the one with a consequence: forget the token. */
export type PushError =
  NonNullable<NonNullable<ExpoPushErrorReceipt['details']>['error']> | 'other';

export type PushMessage = {
  to: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
};

/** A send answers with a ticket, which a later receipt turns into a delivery or an error. */
export type PushSend = { ok: true; ticket: string } | { ok: false; error: PushError };
export type PushReceipt = { ok: true } | { ok: false; error: PushError };

export type Push = {
  /** One result per message, in order. */
  send(messages: readonly PushMessage[]): Promise<PushSend[]>;
  /** The receipts Expo has for these tickets; a ticket it has nothing for yet is absent. */
  receipts(ticketIds: readonly string[]): Promise<Record<string, PushReceipt>>;
};

const errorOf = (details: ExpoPushErrorReceipt['details']): PushError => details?.error ?? 'other';

export function expoPush(accessToken?: string): Push {
  const expo = new Expo(accessToken ? { accessToken } : {});
  return {
    async send(messages) {
      const results: PushSend[] = [];
      for (const chunk of expo.chunkPushNotifications(messages as ExpoPushMessage[])) {
        const tickets = await expo.sendPushNotificationsAsync(chunk);
        for (const ticket of tickets) {
          results.push(
            ticket.status === 'ok'
              ? { ok: true, ticket: ticket.id }
              : { ok: false, error: errorOf(ticket.details) },
          );
        }
      }
      return results;
    },
    async receipts(ticketIds) {
      const out: Record<string, PushReceipt> = {};
      for (const chunk of expo.chunkPushNotificationReceiptIds([...ticketIds])) {
        const receipts = await expo.getPushNotificationReceiptsAsync(chunk);
        for (const [id, receipt] of Object.entries(receipts)) {
          out[id] =
            receipt.status === 'ok' ? { ok: true } : { ok: false, error: errorOf(receipt.details) };
        }
      }
      return out;
    },
  };
}
