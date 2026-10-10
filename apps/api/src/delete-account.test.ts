import { beforeAll, describe, expect, it } from 'vitest';
import { createApp } from './app.ts';
import type { Db } from './db/client.ts';
import { fakeVerifyToken } from './test/auth.ts';
import { freshDb } from './test/db.ts';

/**
 * Google Play's account-deletion URL (ADR-0019). The assertions are what Play's policy asks the
 * page to say, not the prose around it.
 */
let app: ReturnType<typeof createApp>;
let db: Db;

beforeAll(async () => {
  db = await freshDb();
  app = createApp(db, { verifyToken: fakeVerifyToken });
});

/** No `Authorization` header: the person reading this may no longer have the app. */
const get = () => app.request('/delete-account');

describe('GET /delete-account', () => {
  it('is public HTML', async () => {
    const res = await get();
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/text\/html/);
    expect(await res.text()).toMatch(/^<!doctype html>/i);
  });

  const disclosures: [string, RegExp][] = [
    ['the app by its store name', /Mibo: Chores Tracker/],
    ['the developer', /developed by \S+/],
    ['the in-app steps', /More<\/strong> → <strong>Delete my account/],
    ['a request path for someone without the app', /mailto:nadavg1000@gmail\.com\?subject=/],
    ['that the subscription is not cancelled', /does not cancel a subscription/],
    ['what is deleted when the last parent goes', /whole household is deleted/],
    ['that nothing is retained', /Nothing is retained/],
  ];

  it.each(disclosures)('names %s', async (_label, pattern) => {
    expect(await (await get()).text()).toMatch(pattern);
  });
});
