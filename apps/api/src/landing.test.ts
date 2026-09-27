import { beforeAll, describe, expect, it } from 'vitest';
import { createApp } from './app.ts';
import type { Db } from './db/client.ts';
import { fakeVerifyToken } from './test/auth.ts';
import { freshDb } from './test/db.ts';

/**
 * `/` is the apex of `mibokids.app`, which since #84 is also the API's hostname. Three audiences
 * reach it and none of them have an account: Google's OAuth consent screen links it as the
 * application home page, App Review trims the privacy URL to see what is there, and a parent does
 * the same. A 404 reads as an abandoned app to all three, so the apex answers.
 *
 * It is deliberately not a marketing site — the name, one line, and the two documents.
 */
let app: ReturnType<typeof createApp>;
let db: Db;

beforeAll(async () => {
  db = await freshDb();
  app = createApp(db, { verifyToken: fakeVerifyToken });
});

const get = () => app.request('/');

describe('GET /', () => {
  it('is public HTML, not a 404', async () => {
    const res = await get();
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/text\/html/);
    expect(await res.text()).toMatch(/^<!doctype html>/i);
  });

  it('says which app this is', async () => {
    expect(await (await get()).text()).toMatch(/Mibo/);
  });

  it('links both documents the consent screen also links', async () => {
    const body = await (await get()).text();
    expect(body).toMatch(/href="\/privacy"/);
    expect(body).toMatch(/href="\/terms"/);
  });

  it('offers a way to reach a human', async () => {
    expect(await (await get()).text()).toMatch(/nadavg1000@gmail\.com/);
  });

  it('does not shadow the API', async () => {
    // Mounting a route at `/` is the one change that can swallow the rest of the app, and
    // `/health` is what `scripts/check-deploy.sh` asks. So it is asserted from here too.
    const res = await app.request('/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true });
  });
});
