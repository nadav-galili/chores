import { ANALYTICS_HOST, type AnalyticsEvent } from '@chores/shared';
import { PostHog } from 'posthog-node';

/**
 * The analytics sink, behind the little of it this app uses (ADR-0009). Routes talk to this type,
 * so a test can read what was sent without a network and a deployment with no key sends nothing.
 *
 * Every server event goes out under the distinct id it originated from — a parent's Clerk id, or
 * the anon id of the kid device the event is about — so the server's half of a story joins the
 * device's half.
 */

/** One event on its way out: what it is, who it came from, and what it is about. */
export type SentEvent = {
  distinctId: string;
  event: AnalyticsEvent;
  groups?: Record<string, string>;
};

export type Analytics = {
  capture(sent: SentEvent): void;
  /** Flushes what is queued; called when the process is going away. */
  shutdown(): Promise<void>;
};

/** What runs in tests and in any deployment without a key: analytics is never load-bearing. */
export const noAnalytics: Analytics = {
  capture() {},
  async shutdown() {},
};

export function posthogAnalytics(apiKey: string | undefined): Analytics {
  if (!apiKey) return noAnalytics;
  const client = new PostHog(apiKey, { host: ANALYTICS_HOST });
  return {
    capture({ distinctId, event, groups }) {
      client.capture({
        distinctId,
        event: event.event,
        properties: event.properties,
        ...(groups ? { groups } : {}),
      });
    },
    shutdown: () => client.shutdown(),
  };
}

/** Collects what would have been sent. Used by the tests that prove what an event may carry. */
export function recordingAnalytics(): Analytics & { sent: SentEvent[] } {
  const sent: SentEvent[] = [];
  return {
    sent,
    capture(one) {
      sent.push(one);
    },
    async shutdown() {},
  };
}
