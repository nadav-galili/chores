import { describe, expect, it } from 'vitest';
import { householdHash } from './analytics.ts';
import { errorReportingTags, scrubBreadcrumb, scrubErrorEvent } from './error-reporting.ts';

describe('scrubBreadcrumb', () => {
  it('drops console breadcrumbs, which is where a chore title or a first name leaks', () => {
    expect(
      scrubBreadcrumb({
        category: 'console',
        level: 'log',
        message: 'saving chore "Bins" for Noa',
      }),
    ).toBeNull();
  });
});

describe('scrubBreadcrumb: a request', () => {
  const crumb = {
    category: 'xhr',
    type: 'http',
    level: 'info',
    timestamp: 1,
    data: {
      method: 'POST',
      status_code: 401,
      url: 'https://api.example.com/join-codes/7KQ2PX/redeem?child=Noa',
      request_body: '{"join_code":"7KQ2PX"}',
    },
  };

  it('keeps the method and the status', () => {
    expect(scrubBreadcrumb(crumb)?.data).toMatchObject({ method: 'POST', status_code: 401 });
  });

  it('drops the query string and any path segment that could be an id or a join code', () => {
    expect(scrubBreadcrumb(crumb)?.data?.url).toBe('https://api.example.com/join-codes/*/redeem');
  });

  it('drops every other field, because the allowlist is the whole of what is sent', () => {
    expect(Object.keys(scrubBreadcrumb(crumb)?.data ?? {}).sort()).toEqual([
      'method',
      'status_code',
      'url',
    ]);
  });
});

describe('scrubBreadcrumb: navigation', () => {
  it('keeps the route and scrubs the params, which is where a chore id rides', () => {
    expect(
      scrubBreadcrumb({
        category: 'navigation',
        data: { from: '/(kid)/today', to: '/(parent)/chore/018f0c2e-1111-7000-8000-000000000001' },
      })?.data,
    ).toEqual({ from: '/*/today', to: '/*/chore/*' });
  });
});

const kid = {
  mode: 'kid' as const,
  ui_mode: 'little' as const,
  household_id: '018f0c2e-2222-7000-8000-000000000002',
};
const parent = { mode: 'parent' as const, clerk_user_id: 'user_2abc' };

describe('errorReportingTags', () => {
  it('says about a kid device exactly what analytics already may (ADR-0009)', () => {
    expect(errorReportingTags(kid)).toEqual({
      mode: 'kid',
      ui_mode: 'little',
      age_band: '5-7',
      household_hash: householdHash(kid.household_id),
    });
  });

  it('says only the mode for a parent: the person goes on `user`, not on a tag', () => {
    expect(errorReportingTags(parent)).toEqual({ mode: 'parent' });
  });
});

describe('scrubErrorEvent: who the event is about', () => {
  it('gives a kid-device event no user at all — a child is not an identity (ADR-0001)', () => {
    const event = scrubErrorEvent({ user: { id: 'whatever', username: 'Noa' } }, kid);
    expect(event.user).toBeUndefined();
  });

  it('identifies a parent by their Clerk id and nothing else', () => {
    const event = scrubErrorEvent(
      { user: { id: 'ignored', email: 'a@b.com', ip_address: '1.2.3.4' } },
      parent,
    );
    expect(event.user).toEqual({ id: 'user_2abc' });
  });

  it('replaces whatever tags the SDK put on the event with the ones the mode allows', () => {
    const event = scrubErrorEvent({ tags: { child_id: 'leak', mode: 'parent' } }, kid);
    expect(event.tags).toEqual(errorReportingTags(kid));
  });
});

describe('scrubErrorEvent: what survives', () => {
  const raw = {
    event_id: 'abc',
    timestamp: 1,
    platform: 'javascript',
    level: 'error',
    environment: 'production',
    release: 'com.mibokids.app@0.0.1',
    dist: '3',
    sdk: { name: 'sentry.javascript.react-native', version: '8.0.0' },
    exception: { values: [{ type: 'Error', value: 'boom', stacktrace: { frames: [] } }] },
    debug_meta: { images: [{ type: 'sourcemap' }] },
    contexts: {
      app: { app_version: '0.0.1' },
      os: { name: 'Android' },
      device: { model: 'Pixel 8', name: "Noa's Phone", simulator: false },
    },
    breadcrumbs: [
      { category: 'console', message: 'chore "Bins"' },
      { category: 'navigation', data: { from: '/(kid)/today', to: '/(kid)/shop' } },
    ],
    extra: { chore_title: 'Bins' },
    request: { url: 'https://api.example.com/sync?child=Noa', headers: { Cookie: 'x' } },
    server_name: 'noas-phone',
    message: 'Noa could not save',
  };

  it('keeps the stack trace and the release, which is the whole point of reporting', () => {
    const event = scrubErrorEvent(raw, kid);
    expect(event.exception).toEqual(raw.exception);
    expect(event.debug_meta).toEqual(raw.debug_meta);
    expect(event).toMatchObject({ release: raw.release, dist: '3', environment: 'production' });
  });

  it('drops every top-level field that is not on the allowlist', () => {
    const event = scrubErrorEvent(raw, kid);
    expect(event.extra).toBeUndefined();
    expect(event.request).toBeUndefined();
    expect(event.server_name).toBeUndefined();
    expect(event.message).toBeUndefined();
  });

  it('allowlists every context branch, not just the device', () => {
    // `view_names` is the navigation integration writing the current route into `contexts.app`.
    const event = scrubErrorEvent(
      { contexts: { app: { app_version: '1', view_names: ['/chore/Take out the bins'] } } },
      kid,
    );
    expect(event.contexts).toEqual({ app: { app_version: '1' } });
  });

  it('keeps the device it ran on but not what the owner named it', () => {
    const event = scrubErrorEvent(raw, kid);
    expect(event.contexts).toEqual({
      app: { app_version: '0.0.1' },
      os: { name: 'Android' },
      device: { model: 'Pixel 8', simulator: false },
    });
  });

  it('scrubs the breadcrumbs the native layer attached without asking beforeBreadcrumb', () => {
    const event = scrubErrorEvent(raw, kid);
    expect(event.breadcrumbs).toEqual([
      { category: 'navigation', data: { from: '/*/today', to: '/*/shop' } },
    ]);
  });
});

describe('a kid-device event, read as the wire would carry it', () => {
  // The four things ADR-0009 forbids, planted in every field an SDK fills in by itself.
  const forbidden = ['Noa', 'Pip', 'Take out the bins', '7KQ2PX'];

  it('carries no first name, pet name, chore title or join code anywhere in the payload', () => {
    const event = scrubErrorEvent(
      {
        user: { id: 'child-1', username: 'Noa', email: 'Noa@example.com' },
        tags: { pet_name: 'Pip', chore: 'Take out the bins' },
        extra: { join_code: '7KQ2PX' },
        message: 'Noa could not save Take out the bins',
        server_name: 'Noa-phone',
        request: { url: 'https://api.example.com/join-codes/7KQ2PX', headers: { pet: 'Pip' } },
        contexts: { device: { model: 'Pixel 8', name: "Noa's Phone" }, culture: { pet: 'Pip' } },
        breadcrumbs: [
          { category: 'console', message: 'Take out the bins' },
          { category: 'xhr', data: { url: 'https://api.example.com/join/7KQ2PX?name=Noa' } },
          { category: 'navigation', data: { from: '/(kid)/chore/7KQ2PX', to: '/(kid)/today' } },
        ],
        exception: { values: [{ type: 'Error', value: 'sync refused the op' }] },
      },
      kid,
    );
    const wire = JSON.stringify(event);
    for (const secret of forbidden) expect(wire).not.toContain(secret);
    // And it is still worth reading.
    expect(wire).toContain('sync refused the op');
  });
});

describe('scrubErrorEvent: the one tag the app writes itself', () => {
  it('keeps `where`, the hand-written name of the catch that reported', () => {
    const event = scrubErrorEvent({ tags: { where: 'parent-sign-in.google' } }, kid);
    expect(event.tags).toEqual({ ...errorReportingTags(kid), where: 'parent-sign-in.google' });
  });

  it('drops a `where` that is not a hand-written name, because then it is a value', () => {
    const event = scrubErrorEvent({ tags: { where: 'could not save Take out the bins' } }, kid);
    expect(event.tags).toEqual(errorReportingTags(kid));
  });

  it('still lets nothing else through', () => {
    const event = scrubErrorEvent({ tags: { where: 'sync.push', pet_name: 'Pip' } }, kid);
    expect(event.tags).not.toHaveProperty('pet_name');
  });
});

describe('the default context: neither mode has said who it is yet', () => {
  it('carries no user and claims no mode it cannot back up', () => {
    const event = scrubErrorEvent({ user: { id: 'x' } }, { mode: 'unknown' });
    expect(event.user).toBeUndefined();
    expect(event.tags).toEqual({ mode: 'unknown' });
  });
});
