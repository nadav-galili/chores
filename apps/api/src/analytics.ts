import { ANALYTICS_HOST, withAppEnv, type AnalyticsEvent, type AppEnv } from '@chores/shared';
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

export function posthogAnalytics(apiKey: string | undefined, env: AppEnv): Analytics {
  if (!apiKey) return noAnalytics;
  const client = new PostHog(apiKey, { host: ANALYTICS_HOST });
  return {
    capture({ distinctId, event, groups }) {
      const tagged = withAppEnv(event, env);
      client.capture({
        distinctId,
        event: tagged.event,
        properties: tagged.properties,
        ...(groups ? { groups } : {}),
      });
    },
    shutdown: () => client.shutdown(),
  };
}

/**
 * Deletes these PostHog persons and every event they sent, for Account Deletion (ADR-0019). The
 * ids are distinct ids: a parent's Clerk id, a kid device's anon id.
 */
export type DeleteAnalyticsPersons = (distinctIds: readonly string[]) => Promise<void>;

/** PostHog's private API for the EU project; `ANALYTICS_HOST` is ingestion only. */
const POSTHOG_API = 'https://eu.posthog.com';
/** What one `bulk_delete` request accepts. */
const BULK_DELETE_MAX = 1000;

/**
 * `POST /persons/bulk_delete` with a personal API key holding `person:write`. PostHog queues the
 * deletion and answers 202, and reports a person it could not delete inside `deletion_errors`
 * rather than with a status — so both are read. A distinct id PostHog never saw is not an error:
 * a device with no key sent nothing.
 */
export function posthogPersonDeletion(
  personalApiKey: string,
  projectId: string,
  fetchImpl: typeof fetch = fetch,
): DeleteAnalyticsPersons {
  return async (distinctIds) => {
    for (let i = 0; i < distinctIds.length; i += BULK_DELETE_MAX) {
      const res = await fetchImpl(
        `${POSTHOG_API}/api/projects/${encodeURIComponent(projectId)}/persons/bulk_delete/`,
        {
          method: 'POST',
          headers: {
            authorization: `Bearer ${personalApiKey}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            distinct_ids: distinctIds.slice(i, i + BULK_DELETE_MAX),
            delete_events: true,
            delete_recordings: true,
          }),
        },
      );
      if (!res.ok) throw new Error(`posthog person deletion failed: ${res.status}`);
      const body = (await res.json().catch(() => ({}))) as { deletion_errors?: unknown[] };
      if (body.deletion_errors?.length) {
        throw new Error(
          `posthog person deletion failed for ${body.deletion_errors.length} persons`,
        );
      }
    }
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
