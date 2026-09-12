import {
  errorReportingTags,
  scrubBreadcrumb,
  scrubErrorEvent,
  type ErrorReportingContext,
  type DeviceSession,
} from '@chores/shared';
import * as Sentry from '@sentry/react-native';

/**
 * The one place this app talks to Sentry (ADR-0015).
 *
 * It exists because a failure on a child's device is otherwise invisible: there is nobody there to
 * read a red string, and the Google sign-in bug cost an instrumented local build to learn something
 * the device already knew (#35, #36).
 *
 * Everything about the shape of what is sent lives in `@chores/shared`, which is where the tests
 * are. This file is the wiring: when the reporter starts, when it does not, and who it says the
 * running app is. Like `analytics.ts`, nothing here is load-bearing — with no DSN every call is a
 * no-op and the app behaves exactly the same.
 */

const dsn = process.env.EXPO_PUBLIC_SENTRY_DSN;

/**
 * Who the running app is. Held here rather than on Sentry's scope because `beforeSend` has to
 * rebuild the event from nothing, and a scope it did not set is a scope it cannot trust.
 *
 * It starts as `unknown` and not as a parent, because a device that has not yet said which mode it
 * is in may turn out to be a kid device — a crash on the join screen, or during startup, before
 * `setKidErrorContext` has run. An `unknown` event carries no user at all, so the worst case is an
 * unattributed crash rather than a child with an identity.
 */
let context: ErrorReportingContext = { mode: 'unknown' };

/**
 * Starts the reporter, once, at the top of the app.
 *
 * Development is excluded outright: a Metro reload throws things that are not bugs, and local
 * noise in the project would train everyone to ignore it. `enabled` is the documented replacement
 * for the removed `enableInExpoDevelopment`.
 */
export function startErrorReporting(): void {
  if (!dsn || __DEV__) return;
  Sentry.init({
    dsn,
    enabled: true,
    // PII is what this whole integration is fighting; the SDK's own default-on fields — IP
    // address, device name, request bodies — are turned off at the source as well as scrubbed.
    sendDefaultPii: false,
    // Session replay would film a child's screen. Not now (#35).
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0,
    // Both default to off; pinned because they are the two payloads `beforeSend` cannot rebuild,
    // and a screenshot of a kid device is a photograph of everything this file is protecting.
    attachScreenshot: false,
    attachViewHierarchy: false,
    // Crashes and handled errors only; no tracing.
    tracesSampleRate: 0,
    integrations: (defaults) => [
      ...defaults.filter((integration) => integration.name !== 'Breadcrumbs'),
      // Console output is free text written all over the app and is the easiest way for a chore
      // title to escape, so it is off at the source as well as dropped in `scrubBreadcrumb`.
      // Requests survive because they are structured enough to scrub field by field.
      Sentry.breadcrumbsIntegration({ console: false, fetch: false, xhr: true, sentry: false }),
    ],
    beforeBreadcrumb: (crumb) => scrubBreadcrumb(crumb) as Sentry.Breadcrumb | null,
    // The shared scrubber returns a plain object built from an allowlist, so it cannot be typed
    // as the SDK's nominal `ErrorEvent`; the cast is the seam between the two.
    beforeSend: (event) => scrubErrorEvent(event, context) as unknown as Sentry.ErrorEvent,
  });
}

/** A parent has signed in: the same Clerk id analytics uses, and no other field. */
export function setParentErrorContext(clerkUserId: string): void {
  context = { mode: 'parent', clerk_user_id: clerkUserId };
  apply();
}

/**
 * A kid device has loaded its session. There is no id here and there will not be one — a child is
 * not an identity (ADR-0001) and is anonymous per device (ADR-0009).
 */
export function setKidErrorContext(session: DeviceSession): void {
  context = {
    mode: 'kid',
    ui_mode: session.child.ui_mode,
    household_id: session.household.id,
  };
  apply();
}

/**
 * Reports an error the app caught and handled. The screen still says what it says; this is the
 * other half of "a catch never discards its cause" for the failures nobody is watching.
 *
 * `where` is a fixed string naming the call site, written by hand — never a value, and never
 * anything a parent typed or a child was named.
 */
export function reportError(cause: unknown, where: string): void {
  Sentry.captureException(cause, { tags: { where } });
}

/** Mirrors the context onto the scope, so an event the SDK sends without asking us is tagged too. */
function apply(): void {
  Sentry.setUser(context.mode === 'parent' ? { id: context.clerk_user_id } : null);
  Sentry.setTags(errorReportingTags(context));
}
