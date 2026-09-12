/**
 * What a crash report is allowed to contain (ADR-0009, ADR-0015).
 *
 * Every function here is an allowlist: it builds a new object out of the fields that are known to
 * be safe rather than deleting the fields that are known to be dangerous. A deny list is a list of
 * the leaks somebody remembered; the next SDK release adds a field nobody remembered, and it ships.
 *
 * Nothing here talks to the reporter. The device hands these to `beforeBreadcrumb` and `beforeSend`,
 * and the test next to this file is what keeps the rule true.
 */

import { kidProperties } from './analytics.ts';
import type { UiMode } from './child.ts';

/**
 * Who the running app is, as a crash report may describe them. A parent is a person the service
 * may know — their Clerk id, the same identity analytics uses. A kid device is nobody: it carries
 * the three properties ADR-0009 already allows a kid device to say about itself, and no id.
 */
export type ErrorReportingContext =
  | { mode: 'unknown' }
  | { mode: 'parent'; clerk_user_id: string }
  | { mode: 'kid'; ui_mode: UiMode; household_id: string };

/**
 * The whole of what an event may be tagged with, per mode.
 *
 * `unknown` is the mode the app boots in, before either side has said who it is — a crash on the
 * join screen or during startup. It has to be its own mode rather than a parent with an empty id,
 * because a device that turns out to be a kid device would otherwise have shipped a `user` (#35).
 */
export function errorReportingTags(context: ErrorReportingContext): Record<string, string> {
  if (context.mode !== 'kid') return { mode: context.mode };
  const kid = kidProperties({ ui_mode: context.ui_mode, household_id: context.household_id });
  return {
    mode: 'kid',
    ui_mode: String(kid.ui_mode),
    age_band: String(kid.age_band),
    household_hash: String(kid.household_hash),
  };
}

/**
 * The one tag the app writes itself: the name of the `catch` that reported, as a hand-written
 * constant. The pattern is the enforcement — a `where` carrying a value rather than a name has a
 * space or a capital in it and is dropped, so a caller cannot smuggle a chore title through the
 * one field that survives.
 */
const WHERE_TAG = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/;

/** The one move this file makes, everywhere: a new object holding only the named keys. */
function pick(source: Record<string, unknown>, keys: readonly string[]): Record<string, unknown> {
  const kept: Record<string, unknown> = {};
  for (const key of keys) if (key in source) kept[key] = source[key];
  return kept;
}

/** The shape of an event this module needs; the SDK's own type is a superset. */
export type ErrorEvent = {
  user?: Record<string, unknown>;
  tags?: Record<string, string>;
  [key: string]: unknown;
};

/**
 * The fields of an event that carry diagnosis and nothing about a person: the error itself, where
 * the binary came from, and what the SDK needs to symbolicate it. `extra`, `request`, `message`
 * and `server_name` are all absent on purpose — each is free text or a URL somebody else fills in.
 */
const ALLOWED_EVENT_KEYS = [
  'event_id',
  'timestamp',
  'platform',
  'type',
  'level',
  'logger',
  'environment',
  'release',
  'dist',
  'sdk',
  'exception',
  'threads',
  'debug_meta',
  'fingerprint',
] as const;

/**
 * Which contexts survive, and how much of each — field by field in every branch, because an
 * allowlist with one wholesale copy inside it is a deny list. `contexts.app.view_names` is the
 * concrete reason: the navigation integration writes the current route names there.
 */
const ALLOWED_CONTEXTS = {
  app: [
    'app_identifier',
    'app_name',
    'app_version',
    'app_build',
    'app_start_time',
    'in_foreground',
  ],
  os: ['name', 'version', 'build', 'kernel_version', 'rooted'],
  runtime: ['name', 'version'],
  device: [
    'model',
    'model_id',
    'manufacturer',
    'brand',
    'family',
    'arch',
    'simulator',
    'memory_size',
    'free_memory',
    'low_memory',
    'screen_width_pixels',
    'screen_height_pixels',
    'screen_density',
    'orientation',
    'locale',
  ],
} as const;

/**
 * The event as it is allowed to leave the device: rebuilt from the allowlists above, never edited.
 *
 * What this cannot reach is the exception's own message. A `throw new Error(...)` that interpolates
 * a chore title puts it in the stack trace, and no scrubber downstream can tell it from a real
 * error string — which is why the rule lives in `CODING_STANDARDS.md` as well as here (ADR-0015).
 */
export function scrubErrorEvent(event: object, context: ErrorReportingContext): ErrorEvent {
  const source = event as Record<string, unknown>;
  const scrubbed: ErrorEvent = pick(source, ALLOWED_EVENT_KEYS);
  scrubbed.tags = errorReportingTags(context);
  const where = (source.tags as Record<string, unknown> | undefined)?.where;
  if (typeof where === 'string' && WHERE_TAG.test(where)) scrubbed.tags.where = where;
  if (context.mode === 'parent') scrubbed.user = { id: context.clerk_user_id };
  const contexts = scrubContexts(source.contexts);
  if (contexts) scrubbed.contexts = contexts;
  // The native layer attaches its own breadcrumbs to a crash without passing them through
  // `beforeBreadcrumb`, so the same allowlist is applied again here, where every event arrives.
  if (Array.isArray(source.breadcrumbs))
    scrubbed.breadcrumbs = (source.breadcrumbs as ErrorBreadcrumb[])
      .map(scrubBreadcrumb)
      .filter((crumb): crumb is ErrorBreadcrumb => crumb !== null);
  return scrubbed;
}

function scrubContexts(contexts: unknown): Record<string, unknown> | undefined {
  if (!contexts || typeof contexts !== 'object') return undefined;
  const source = contexts as Record<string, unknown>;
  const scrubbed: Record<string, unknown> = {};
  for (const [name, keys] of Object.entries(ALLOWED_CONTEXTS)) {
    const branch = source[name];
    if (branch && typeof branch === 'object')
      scrubbed[name] = pick(branch as Record<string, unknown>, keys);
  }
  return scrubbed;
}

/** The shape of a breadcrumb this module needs; the SDK's own type is a superset. */
export type ErrorBreadcrumb = {
  category?: string;
  type?: string;
  level?: string;
  timestamp?: number;
  message?: string;
  data?: Record<string, unknown>;
};

/**
 * The breadcrumb categories the app is willing to send, and nothing else.
 *
 * `console` is absent on purpose: console output is free text written all over the app, and a
 * single `console.log(chore)` would ship a chore title. Requests and navigation survive because
 * they are structured enough to be scrubbed field by field, below. `fetch` is absent because
 * React Native polyfills fetch over XHR, so `xhr` is the category those arrive under.
 */
const ALLOWED_CATEGORIES = new Set(['xhr', 'navigation']);

/** What a request breadcrumb may say. A body, headers and a cookie are not on it. */
const ALLOWED_REQUEST_DATA = ['method', 'status_code'] as const;

/** What a navigation breadcrumb may say: two routes, each scrubbed like a path. */
const ALLOWED_ROUTE_DATA = ['from', 'to'] as const;

/**
 * A path with every dynamic-looking segment replaced by `*`. A segment survives only if it reads
 * like a hand-written route — lowercase letters and dashes, no digits — so `/chore/<uuid>` keeps
 * its route and loses the id, and expo-router's `(kid)` group is starred rather than guessed at.
 *
 * The residual is a lowercase word: `/pet/pip` is indistinguishable from a route named `pip`. That
 * is covered by the rule and not by the regex — nothing a child or a parent typed may be put in a
 * path in the first place (`CODING_STANDARDS.md`, child privacy).
 */
function scrubPath(path: string): string {
  return path
    .split('/')
    .map((segment) => (segment === '' || /^[a-z][a-z-]*$/.test(segment) ? segment : '*'))
    .join('/');
}

/**
 * A URL as a breadcrumb may hold it: origin and path, with every dynamic-looking segment replaced.
 *
 * The query string goes whole — nothing in this app needs it and a name can end up there. The path
 * is scrubbed segment by segment, so `/join-codes/7KQ2PX/redeem` keeps its route and loses the
 * Join Code. An unparseable URL is dropped rather than guessed at.
 */
function scrubUrl(url: string): string | undefined {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    // Not a URL we can take apart is not a URL we can prove is safe.
    return undefined;
  }
  return `${parsed.origin}${scrubPath(parsed.pathname)}`;
}

export function scrubBreadcrumb(crumb: ErrorBreadcrumb): ErrorBreadcrumb | null {
  if (!crumb.category || !ALLOWED_CATEGORIES.has(crumb.category)) return null;
  const scrubbed: ErrorBreadcrumb = {
    category: crumb.category,
    ...(crumb.type ? { type: crumb.type } : {}),
    ...(crumb.level ? { level: crumb.level } : {}),
    ...(crumb.timestamp ? { timestamp: crumb.timestamp } : {}),
    data: scrubBreadcrumbData(crumb.data),
  };
  return scrubbed;
}

function scrubBreadcrumbData(data: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!data) return {};
  const scrubbed = pick(data, ALLOWED_REQUEST_DATA);
  for (const key of ALLOWED_ROUTE_DATA)
    if (typeof data[key] === 'string') scrubbed[key] = scrubPath(data[key]);
  if (typeof data.url === 'string') {
    const url = scrubUrl(data.url);
    if (url) scrubbed.url = url;
  }
  return scrubbed;
}
